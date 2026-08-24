# Database — Waterpark Leaderboard

Rules for working on this code live in [AGENTS.md](AGENTS.md); game
architecture is in [ARCHITECTURE.md](ARCHITECTURE.md#naming-screen-leaderboard-front-end).
Open items are tracked in [TODOLIST.md](TODOLIST.md#leaderboard--database).

**Status: live.** The `waterpark-leaderboard` WordPress plugin and the
front-end integration in `index.html` are committed and merged to `main`,
deployed to the Kinsta dev environment (`env-typhoontexasnew-dev`), and
verified against a real WordPress install (WP 7.1, PHP 8.3.25).

## Schema

Table: `{wp_prefix}stampede_scores`. Use `$wpdb->prefix`, never hardcode
`wp_`.

| Column | Type | Required | Purpose |
|---|---|---:|---|
| `id` | `BIGINT UNSIGNED` | Yes | Primary key |
| `token` | `CHAR(32)` | Yes | Login-less player identity; the upsert key, unique per `game_key` |
| `player_name` | `VARCHAR(64)` | Yes | Public display name, reserved from a closed word pool; unique per `game_key` |
| `score` | `BIGINT UNSIGNED` | Yes | Player's current best score |
| `created_at` | `DATETIME` | Yes | Timestamp of the current best; also the tie-break field |
| `game_key` | `VARCHAR(50)` | Yes | Identifies the game that generated the score (`waterpark`) |
| `session_id` | `VARCHAR(100)` | No | Optional per-run diagnostic identifier — distinct from `token` |
| `metadata` | `LONGTEXT` | No | Optional JSON, reserved for future use |

```sql
CREATE TABLE {prefix}stampede_scores (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    token CHAR(32) NOT NULL,
    player_name VARCHAR(64) NOT NULL,
    score BIGINT UNSIGNED NOT NULL,
    created_at DATETIME NOT NULL,
    game_key VARCHAR(50) NOT NULL,
    session_id VARCHAR(100) NULL,
    metadata LONGTEXT NULL,

    PRIMARY KEY (id),
    UNIQUE KEY idx_game_token (game_key, token),
    UNIQUE KEY idx_game_name (game_key, player_name),
    KEY idx_game_score (game_key, score, created_at),
    KEY idx_game_created (game_key, created_at),
    KEY idx_session (session_id)
);
```

Built with `dbDelta()`; schema version tracked in a WP option
(`waterpark_leaderboard_db_version`). Character set/collation come from
`$wpdb->get_charset_collate()` — never hardcoded (verified live:
`utf8mb4_unicode_520_ci`, picked up from the site). Timestamps are stored in
UTC; any future date-range filtering must convert to UTC before querying
`created_at`, not rely on server-local time.

## Storage model — one row per player

Upsert on personal best, **not** one row per run — appending a row per run
lets a dedicated player fill the whole top 50 and turns "your rank" into
"#N of every run ever played." A consequence: **this schema does not retain
full run history**; a run that doesn't beat the player's best is not
persisted anywhere. A second, append-only table would be needed for
per-run analytics.

```sql
INSERT INTO {prefix}stampede_scores
    (game_key, token, player_name, score, created_at)
VALUES
    (%s, %s, %s, %s, %s)
ON DUPLICATE KEY UPDATE
    score      = IF(VALUES(score) > score, VALUES(score), score),
    created_at = IF(VALUES(score) > score, VALUES(created_at), created_at);
```

The `IF(...)` guards matter — without them, `ON DUPLICATE KEY UPDATE`
overwrites `score`/`created_at` on *every* submission, silently losing the
true achievement time used for tie-breaking.

## Design decisions

- **`token` (not `session_id`) is the upsert identity key.** Generated
  server-side at name-claim time (`bin2hex(random_bytes(16))`), returned to
  the client once, stored client-side. No email or PII collected. Never
  treat a client-supplied token as proof of identity beyond a lookup — it's
  a key against an existing row, never chosen or guessed by the client.
- **`session_id` is a per-run diagnostic value**, not identity — does not
  participate in the upsert lookup. Not unique until a final submission
  model is defined.
- **`player_name` is unique per `game_key`.** Names are drawn from a closed,
  pre-audited word pool (adjective × noun) at claim time, never typed
  freely. A collision on insert is expected and resolved by the
  application layer appending a random 3-digit suffix and retrying — never
  by allowing a duplicate row. The suffix's own digit blocklist (`187`,
  `322`, `420`, `451`, `666`, `911` — 3-digit only, since the generator
  draws 100–999) is submission-layer logic; the database only enforces the
  uniqueness it depends on.
- **Tie-break ordering:** `ORDER BY score DESC, created_at ASC, id ASC` —
  the first player to reach a tied score ranks ahead. Scoring is coarse
  enough that exact ties across many players are expected, not rare.
- **`metadata` (LONGTEXT, JSON)** is for optional/experimental values only
  — never core leaderboard fields. Promote a value to a real column if it
  ever needs filtering, sorting, or indexing.
- **Never store scores as strings or floats** — `BIGINT UNSIGNED` only.
- **No custom WordPress posts/postmeta, no ACF repeater for scores.**
  Leaderboard rows are application data, not editorial content; a repeater
  serialises the whole leaderboard into one `postmeta` row, and concurrent
  finishes at park volume routinely read-modify-write over each other and
  lose scores. ACF may still configure leaderboard *settings* (enabled,
  result count, contest dates) — never individual score records.
- **Data is retained indefinitely.** No automatic deletion of a player's
  row, and plugin deactivation must preserve data — table size is bounded
  by player count, not run count, so retention pressure is low.
- **All access goes through `$wpdb->prepare()`** — never interpolate
  user-supplied values into SQL directly. Database access is isolated
  behind `Waterpark_Score_Repository` rather than scattered through the
  plugin.

## Query patterns the schema is optimized for

```sql
-- Top scores
WHERE game_key = ? ORDER BY score DESC, created_at ASC LIMIT ?
-- Player rank
SELECT COUNT(*) + 1 WHERE game_key = ? AND score > ?
-- Token lookup (the upsert key)
WHERE game_key = ? AND token = ?
-- Session lookup
WHERE session_id = ?
-- Historical export
WHERE game_key = ? AND created_at >= ? AND created_at < ?
```

## Front-end integration (`Board`, in `index.html`)

`Board.me()` is local/synchronous (reads the device's own cached rider);
`claim()`, `submit()`, `top(n)`, `rankOf(score)`, `takenNames()` are async,
calling the plugin's REST routes (`/claim`, `/submit`, `/leaderboard`,
`/rank`, `/names`) same-origin.

- **Naming screen fails open**: if `/names` errors or times out (5s), reels
  paint from an empty taken-set rather than blocking the screen — the game
  must stay playable on a bad network. Every reroll draws locally against
  the fetched taken-set (bounded at 25 attempts); a genuine race between two
  players falls through to `claim()`'s own server-side suffix retry.
- **`submit()` is fire-and-forget** — the results card banks the score
  locally first and never waits on the network.
- `namesPromise` is started as early as possible (parallel with sprite
  loading) so the naming screen never shows blank reels — see
  [ARCHITECTURE.md](ARCHITECTURE.md#loading-screen).

**⚠️ `Board`'s `API` constant is currently an absolute URL**
(`index.html`, `const API = ...`) pointed at the Kinsta dev site, not the
relative `/wp-json/waterpark-leaderboard/v1` path it ships with. This lets
the game be tested against the live dev database before it's embedded in
WordPress. **Must be reverted to the relative path before `index.html` is
served from the WordPress site itself**, or it will keep talking to the dev
environment from production. Tracked in [TODOLIST.md](TODOLIST.md#leaderboard--database).

**Accepted, not addressed:** anyone can claim any name, and score is computed
in client-side JS anyone can read, so it's forgeable. Fine for a park promo;
revisit only if the board actually gets gamed.

## Word pool

`NAME_A` × `NAME_B` = 100 × 100 = 10,000 combinations, mirrored byte-for-byte
into `waterpark-leaderboard/includes/class-name-pool.php` (the claim endpoint
validates server-side, never trusts client text).

**Ruled on by the user (2026-08-18):** the original 40×40 pool was read
word-by-word for tone/trademark/association. Only `Blazin'` was cut
(cannabis-slang read plus letting it stand made a couple of noun pairings
land wrong) and replaced with `Trusty`. Everything else flagged in that
audit was **explicitly kept** — recorded here so it isn't re-litigated:

- `Bellyflop`, `Stallion`, `Sizzlin'` — flagged as body/virility-adjacent in
  some pairings, kept anyway.
- `Riptide`, `Whirlpool`, `Ripcurl` — water-hazard words at a water park,
  kept; on-theme outweighs the association.
- `Longhorn`, `Mustang`, `Bronco`, `Wrangler`, `Ripcurl`, `Whirlpool`,
  `Gator`, `Frosty`, `Maverick` — trademark/brand association, kept as
  non-infringing first-name use. `Longhorn` (UT Athletics, in a Texas park)
  is the one worth a second look if this is ever revisited.
- `Blazin'` *(removed)*, `Sunbaked`, `Drippy`, `Catfish`, `Stormy`,
  `Cowpoke` — minor slang/association readings, kept.

**Not yet audited to the same bar:** the 60 new adjectives and 60 new nouns
added in the 2026-08-20 expansion (40×40 → 100×100) were screened by Claude
for the same categories while writing them, but have not had the user's own
word-by-word read the original 80 got. Tracked in
[TODOLIST.md](TODOLIST.md#leaderboard--database).
