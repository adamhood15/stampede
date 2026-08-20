# Waterpark Leaderboard Database Plan

## Objective

Create a durable, scalable database structure inside WordPress for storing player leaderboard submissions.

This phase covers **database design only**. It does not include REST API endpoints, frontend leaderboard rendering, score validation/anti-cheat logic, admin UI, or ACF configuration.

---

## Recommended Approach

Use a dedicated custom WordPress database table rather than storing leaderboard submissions in ACF fields, post meta, or an ACF repeater.

Recommended table name:

```text
{wp_prefix}waterpark_scores
```

Use WordPress's `$wpdb->prefix` rather than hardcoding `wp_` so the implementation works on sites with a custom table prefix.

Example:

```php
$table_name = $wpdb->prefix . 'waterpark_scores';
```

---

## Why a Custom Table

Leaderboard submissions are application data rather than editorial content.

The database must efficiently support:

- Large numbers of score submissions over time
- Sorting by score
- Filtering by submission date
- Retrieving daily leaderboard results
- Retrieving all-time leaderboard results
- Looking up an individual submission
- Future filtering by game, contest, or event
- Future data cleanup, exports, and archival

A dedicated table makes these operations significantly simpler and more scalable than an ACF repeater or WordPress post meta.

---

## Initial Table Schema

Create a table with the following columns:

| Column | Type | Required | Purpose |
|---|---|---:|---|
| `id` | `BIGINT UNSIGNED` | Yes | Primary key |
| `player_name` | `VARCHAR(50)` | Yes | Public display name submitted by the player |
| `score` | `BIGINT UNSIGNED` | Yes | Player's submitted score |
| `created_at` | `DATETIME` | Yes | Timestamp when the score was stored |
| `game_key` | `VARCHAR(50)` | Yes | Identifies the game that generated the score |
| `session_id` | `VARCHAR(100)` | No | Optional identifier for a game/session submission |
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
CREATE TABLE {prefix}waterpark_scores (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    player_name VARCHAR(50) NOT NULL,
    score BIGINT UNSIGNED NOT NULL,
    created_at DATETIME NOT NULL,
    game_key VARCHAR(50) NOT NULL,
    session_id VARCHAR(100) NULL,
    metadata LONGTEXT NULL,

    PRIMARY KEY (id),

    KEY idx_game_score (game_key, score),
    KEY idx_game_created (game_key, created_at),
    KEY idx_game_created_score (game_key, created_at, score)
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

### Game + Score Index

```text
(game_key, score)
```

Supports all-time leaderboard queries such as:

```sql
SELECT *
FROM wp_waterpark_scores
WHERE game_key = 'waterpark'
ORDER BY score DESC
LIMIT 10;
```

### Game + Created Date Index

```text
(game_key, created_at)
```

Supports date-range filtering, cleanup jobs, exports, and daily leaderboard queries.

### Game + Created Date + Score Index

```text
(game_key, created_at, score)
```

Supports queries that first constrain submissions to a date range and then rank the scores.

Claude should inspect the actual query plans once leaderboard queries are implemented and adjust indexes if needed rather than adding excessive indexes preemptively.

---

## Timestamp Strategy

Store timestamps in UTC.

Use WordPress-compatible UTC timestamps when inserting rows.

Do not base "today" directly on the database server's local timezone.

The future leaderboard layer should:

1. Determine the site's configured WordPress timezone.
2. Calculate the start and end of the requested calendar day in that timezone.
3. Convert that range to UTC.
4. Query `created_at` using the resulting UTC boundaries.

This prevents daylight-saving and server-timezone inconsistencies.

Example conceptual daily query:

```sql
SELECT player_name, score, created_at
FROM wp_waterpark_scores
WHERE game_key = 'waterpark'
  AND created_at >= :day_start_utc
  AND created_at < :next_day_start_utc
ORDER BY score DESC
LIMIT 10;
```

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
VARCHAR(50)
```

for `player_name`.

The database should store the submitted display name after application-level validation and sanitization.

The database layer itself should not attempt to determine whether a name is appropriate, offensive, duplicated, or allowed. Those rules belong in the submission/application layer.

Do not make `player_name` unique.

Multiple players may use the same display name, and the same player may legitimately submit multiple scores.

---

## Session ID

Include:

```text
session_id VARCHAR(100) NULL
```

from the beginning.

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

For the initial version, keep all valid leaderboard submissions indefinitely.

Do not automatically delete scores at the end of each day.

The daily leaderboard should be created by filtering the same historical score table by date.

This allows:

- Daily leaderboard history
- All-time rankings
- Analytics
- Contest audits
- Future reporting

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

### All-Time Top Scores

```sql
WHERE game_key = ?
ORDER BY score DESC
LIMIT ?
```

### Daily Top Scores

```sql
WHERE game_key = ?
AND created_at >= ?
AND created_at < ?
ORDER BY score DESC
LIMIT ?
```

### Find Submission

```sql
WHERE id = ?
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

Do not encode tie-breaking logic into the schema.

The database should preserve:

```text
score
created_at
id
```

This provides enough information for the application layer to define deterministic ordering later.

A likely future ordering rule would be:

```sql
ORDER BY score DESC, created_at ASC, id ASC
```

meaning the first player to achieve a tied score ranks ahead.

The exact tie policy should be confirmed during the leaderboard logic phase.

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
insert_score()
get_score()
get_daily_leaderboard()
get_all_time_leaderboard()
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
- Implement the `{prefix}waterpark_scores` table.
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
- Daily leaderboard rendering
- All-time leaderboard rendering
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
