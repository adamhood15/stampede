# Waterpark Leaderboard Database Plan

## Objective

Create a durable, scalable database structure inside WordPress for storing player leaderboard submissions.

This phase covers **database design only**. It does not include REST API endpoints, frontend leaderboard rendering, score validation/anti-cheat logic, admin UI, or ACF configuration.

---

## Recommended Approach

Use a dedicated custom WordPress database table rather than storing leaderboard submissions in ACF fields, post meta, or an ACF repeater.

Recommended table name:

```text
{wp_prefix}stampede_scores
```

Use WordPress's `$wpdb->prefix` rather than hardcoding `wp_` so the implementation works on sites with a custom table prefix.

Example:

```php
$table_name = $wpdb->prefix . 'stampede_scores';
```

---

## Why a Custom Table

Leaderboard submissions are application data rather than editorial content.

The database must efficiently support:

- Large numbers of score submissions over time
- Sorting by score
- Filtering by submission date
- Retrieving leaderboard results
- Looking up an individual submission
- Upserting a player's row when they beat their own best score
- Future filtering by game, contest, or event
- Future data cleanup, exports, and archival

A dedicated table makes these operations significantly simpler and more scalable than an ACF repeater or WordPress post meta.

---

## Storage Model: One Row Per Player

Store **one row per player, upserted only when they beat their own best score** — not one row per run.

Appending a row per run lets a single dedicated player accumulate dozens of entries and fill the entire top 50, and it turns "your rank" into "#N of every run ever played" instead of the more meaningful "#N of players." Upserting on personal best avoids both.

A consequence worth stating plainly: **this schema does not retain full run history.** A run that does not beat the player's existing best is not persisted anywhere. If per-run analytics or a complete submission audit trail is wanted later, that requires a second, append-only table — out of scope for this phase.

The upsert is keyed by `token` (see the Player Token section below), scoped per `game_key`:

```sql
INSERT INTO {prefix}stampede_scores
    (game_key, token, player_name, score, created_at)
VALUES
    (%s, %s, %s, %s, %s)
ON DUPLICATE KEY UPDATE
    score      = IF(VALUES(score) > score, VALUES(score), score),
    created_at = IF(VALUES(score) > score, VALUES(created_at), created_at);
```

The `IF(...)` guards matter: without them, `ON DUPLICATE KEY UPDATE` would overwrite `score`/`created_at` on *every* submission, including ones that did not actually improve the player's best, silently losing the true achievement time used for tie-breaking.

---

## Initial Table Schema

Create a table with the following columns:

| Column | Type | Required | Purpose |
|---|---|---:|---|
| `id` | `BIGINT UNSIGNED` | Yes | Primary key |
| `token` | `CHAR(32)` | Yes | Login-less player identity; the upsert key, unique per `game_key` |
| `player_name` | `VARCHAR(64)` | Yes | Public display name, reserved from a closed word pool; unique per `game_key` |
| `score` | `BIGINT UNSIGNED` | Yes | Player's current best score |
| `created_at` | `DATETIME` | Yes | Timestamp of the player's current best score; also the tie-break field |
| `game_key` | `VARCHAR(50)` | Yes | Identifies the game that generated the score |
| `session_id` | `VARCHAR(100)` | No | Optional per-run diagnostic identifier — distinct from `token` |
| `metadata` | `LONGTEXT` | No | Optional JSON-encoded data reserved for future use |

Recommended initial `game_key`:

```text
waterpark
```

Even if only one game exists today, include `game_key` from the beginning. This avoids a schema migration if additional games, versions, or seasonal variants are added later.

---

## Proposed SQL Structure

Claude should implement the table using WordPress conventions and `dbDelta()`.

Conceptual schema:

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

Claude should adjust SQL formatting as necessary to ensure compatibility with WordPress `dbDelta()`.

---

## Index Strategy

Indexes are important because the leaderboard will repeatedly query the same data in different ways.

### Primary Key

```text
id
```

Provides a unique identifier for every submission.

### Game + Token Index

```text
UNIQUE (game_key, token)
```

Enforces one row per player per game, and is the lookup the upsert in the Storage Model section above runs against.

### Game + Name Index

```text
UNIQUE (game_key, player_name)
```

Enforces one reserved name per game. A collision on insert (two players landing on the same adjective+noun pair) is expected and is resolved by the application layer appending a random suffix and retrying — not by allowing a duplicate row.

### Game + Score Index

```text
(game_key, score, created_at)
```

Supports leaderboard queries such as:

```sql
SELECT *
FROM wp_stampede_scores
WHERE game_key = 'waterpark'
ORDER BY score DESC, created_at ASC
LIMIT 10;
```

Including `created_at` lets the index satisfy the tie-break ordering directly, without a separate filesort pass.

### Game + Created Date Index

```text
(game_key, created_at)
```

Supports date-range filtering, cleanup jobs, and exports.

### Session Index

```text
(session_id)
```

Supports the session lookup pattern below (`WHERE session_id = ?`) without a full table scan.

Claude should inspect the actual query plans once leaderboard queries are implemented and adjust indexes if needed rather than adding excessive indexes preemptively.

---

## Timestamp Strategy

Store timestamps in UTC.

Use WordPress-compatible UTC timestamps when inserting rows.

Do not base any future date-range filtering (exports, cleanup jobs) directly on the database server's local timezone — convert the requested range to UTC before querying `created_at`, to avoid daylight-saving and server-timezone inconsistencies.

---

## Score Data Type

Use:

```text
BIGINT UNSIGNED
```

for `score`.

This leaves plenty of headroom if the scoring system changes later.

Do not store scores as strings or floating-point values.

---

## Player Name Storage

Use:

```text
VARCHAR(64)
```

for `player_name` — 64 rather than 50, to comfortably fit an adjective + noun pair plus an appended 3-digit collision suffix.

Names are drawn from a closed, pre-audited word pool (adjective x noun combinations) at claim time, not typed freely by the player. That selection, sanitization, and the profanity/blocklist audit happen entirely in the submission/application layer — the database layer should not attempt to determine whether a name is appropriate, offensive, or allowed.

**Make `player_name` unique per `game_key`** (`UNIQUE KEY idx_game_name (game_key, player_name)`).

This is a deliberate reversal from treating names as free text: because names are reserved from a closed pool at creation, two players landing on the same adjective+noun pair is expected and common, and must be resolved by the application layer appending a random 3-digit suffix and retrying the insert — never by allowing a duplicate row. The suffix roll (and its own digit blocklist, e.g. `666`, `420`, `069`, `187`, `13`, `88`) is submission-layer logic; the database only needs to enforce the uniqueness that logic depends on.

---

## Player Token

Include:

```text
token CHAR(32) NOT NULL
```

from the beginning, unique per `game_key` (`UNIQUE KEY idx_game_token (game_key, token)`).

This is a login-less account identifier: generated server-side at name-claim time (e.g. `bin2hex(random_bytes(16))`), returned to the client once, and stored client-side alongside the player's best score. No email or other PII is collected.

The token — not `session_id` — is the identity key the leaderboard upserts against: a submission always includes the caller's token, and the repository looks up the existing row by `(game_key, token)` to decide whether this is a new player or an update to an existing one.

Never treat a client-supplied token as proof of an identity beyond looking it up — it is a lookup key against an existing row, generated only by the server, never chosen or guessed by the client.

---

## Session ID

Include:

```text
session_id VARCHAR(100) NULL
```

from the beginning.

Distinct from `token`: `session_id` is a per-run diagnostic value, not a player identity, and it does not participate in the upsert lookup.

Its exact generation and validation are outside the scope of this database phase.

Potential future uses include:

- Identifying a specific game run
- Detecting duplicate submissions
- Linking a score to server-side validation
- Troubleshooting suspicious submissions
- Preventing accidental resubmission

Do not make this column unique until the final submission model is defined.

---

## Metadata Column

Include an optional:

```text
metadata LONGTEXT NULL
```

column.

Store JSON in this field only for optional or experimental values that do not need to be frequently queried.

Possible future metadata:

```json
{
  "game_version": "1.2.0",
  "level": "main",
  "device_type": "mobile"
}
```

Do **not** place core leaderboard fields inside metadata.

If a metadata value later becomes important for filtering, sorting, or indexing, promote it to a dedicated database column.

---

## Avoid WordPress Posts and Post Meta

Do not model each score as:

```text
wp_posts row
+
wp_postmeta rows
```

The leaderboard is not editorial content and does not need WordPress's post lifecycle, revisions, taxonomy, permalink, or content-management features.

A dedicated table provides a cleaner data model and avoids unnecessary joins and meta queries.

---

## Avoid ACF for Individual Scores

Do not store individual score records inside an ACF repeater.

ACF may still be used later for leaderboard configuration, such as:

- Whether the leaderboard is enabled
- Number of results displayed
- Contest start/end dates
- Leaderboard heading
- Promotional copy

Those settings should remain separate from player-generated score records.

---

## Table Creation

The custom WordPress plugin should create/update the table on plugin activation or version migration.

Use:

```php
require_once ABSPATH . 'wp-admin/includes/upgrade.php';
dbDelta($sql);
```

Maintain a database schema version in a WordPress option, for example:

```text
waterpark_leaderboard_db_version
```

Example:

```text
1.0
```

On plugin load or activation:

1. Read the installed schema version.
2. Compare it to the plugin's expected schema version.
3. Run the required database migration if necessary.
4. Update the stored schema version only after a successful migration.

This provides a clean path for adding columns or indexes later.

---

## Character Set and Collation

Use the site's WordPress database settings:

```php
$charset_collate = $wpdb->get_charset_collate();
```

Do not hardcode a charset or collation.

This ensures names containing accents and other international characters are stored consistently with the rest of the WordPress installation.

---

## Data Retention

For the initial version, keep every player's row indefinitely, even if they never play again.

Do not automatically delete a player's row over time.

This allows:

- All-time rankings
- Analytics
- Contest audits
- Future reporting

Because storage is one row per player rather than one row per run, table size is naturally bounded by player count, not by how many times the game has been played — retention pressure here is much lower than an append-per-run design would create.

If database size becomes significant later, an archival or retention policy can be introduced without changing the basic leaderboard architecture.

---

## Deletion Behavior

Do not automatically remove the score table when the plugin is deactivated.

Plugin deactivation should preserve data.

If an uninstall routine is added later, it should not delete leaderboard data unless that behavior is explicitly intended and documented.

Prefer preserving data by default.

---

## Expected Query Patterns

The schema should be optimized around these eventual operations.

### Top Scores

```sql
WHERE game_key = ?
ORDER BY score DESC, created_at ASC
LIMIT ?
```

### Player Rank

```sql
SELECT COUNT(*) + 1
WHERE game_key = ?
AND score > ?
```

### Upsert Best Score

```sql
INSERT INTO {prefix}stampede_scores (game_key, token, player_name, score, created_at)
VALUES (?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
    score      = IF(VALUES(score) > score, VALUES(score), score),
    created_at = IF(VALUES(score) > score, VALUES(created_at), created_at)
```

### Find Submission

```sql
WHERE id = ?
```

### Token Lookup

```sql
WHERE game_key = ?
AND token = ?
```

### Session Lookup

```sql
WHERE session_id = ?
```

### Historical Export

```sql
WHERE game_key = ?
AND created_at >= ?
AND created_at < ?
```

---

## Tie Handling

The schema does not encode tie-breaking as a constraint, but it does fix the columns needed for one: `score`, `created_at`, `id`.

The canonical ordering, used by the Top Scores query above, is:

```sql
ORDER BY score DESC, created_at ASC, id ASC
```

meaning the first player to achieve a tied score ranks ahead. This matters more than it might first appear: scoring is coarse enough (fixed point values plus per-coin increments) that exact ties across many players are expected, not rare — without a stable tiebreak, tied players would swap places on every leaderboard read.

---

## Database Access Rules for Future Implementation

All future database operations should use `$wpdb`.

Values supplied by users must never be interpolated directly into SQL.

Use:

```php
$wpdb->prepare()
```

for parameterized queries.

Example:

```php
$wpdb->prepare(
    "SELECT * FROM {$table_name}
     WHERE game_key = %s
     ORDER BY score DESC
     LIMIT %d",
    $game_key,
    $limit
);
```

Database access should be isolated behind a small repository/service layer rather than scattered throughout the plugin.

Suggested future class:

```text
Waterpark_Score_Repository
```

Responsibilities would eventually include:

```text
upsert_score()
get_score()
get_by_token()
get_leaderboard()
get_player_rank()
delete_score()
```

Only the storage layer needs to be prepared during this phase.

---

## Suggested Plugin Structure for This Phase

```text
waterpark-leaderboard/
├── waterpark-leaderboard.php
├── includes/
│   ├── class-database.php
│   └── class-score-repository.php
└── uninstall.php
```

For the database-only phase:

### `waterpark-leaderboard.php`

Responsible for:

- Plugin constants
- Plugin version
- Database schema version
- Activation hook
- Loading the database classes

### `class-database.php`

Responsible for:

- Table name resolution
- Table creation
- Schema migrations
- Database version management

### `class-score-repository.php`

Responsible for:

- Encapsulating database reads/writes
- Providing reusable methods for future leaderboard functionality

The repository methods may initially be minimal if score submission logic is intentionally deferred.

---

## Phase 1 Deliverables

Claude should complete only the following:

- Create the custom WordPress plugin skeleton.
- Implement the `{prefix}stampede_scores` table.
- Use `$wpdb->prefix`.
- Use `$wpdb->get_charset_collate()`.
- Implement table creation with `dbDelta()`.
- Add the recommended columns.
- Add the initial indexes.
- Store timestamps in UTC.
- Add database schema version tracking.
- Create a clean migration mechanism for future schema changes.
- Create a database/repository abstraction for future reads and writes.
- Ensure plugin deactivation does not delete leaderboard data.
- Document the schema in the code.

---

## Explicitly Out of Scope

Do **not** implement these items yet:

- REST API endpoints
- JavaScript integration
- Score submission forms
- Leaderboard HTML/CSS
- Leaderboard rendering
- Player ranking calculations
- Anti-cheat mechanisms
- Score validation rules
- Rate limiting
- Nonces
- Authentication
- Profanity filtering
- Admin leaderboard screens
- CSV export
- ACF field groups
- Caching
- Scheduled cleanup jobs
- Contest/prize logic

These should be handled in later phases after the database foundation is reviewed and approved.

---

## Definition of Done

The database phase is complete when activating the plugin on a WordPress installation:

1. Creates the leaderboard table if it does not exist.
2. Uses the site's configured WordPress table prefix.
3. Uses the site's configured charset and collation.
4. Creates all required columns and indexes.
5. Records the current schema version.
6. Can safely run again without destroying existing data.
7. Provides a migration path for future schema versions.
8. Preserves leaderboard records on plugin deactivation.
9. Contains no dependency on ACF for storing player scores.
10. Does not yet expose any public score-submission functionality.
11. Enforces one row per player per game via a unique `(game_key, token)` key, and one reserved name per game via a unique `(game_key, player_name)` key.
