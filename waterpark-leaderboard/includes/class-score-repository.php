<?php
if (!defined('ABSPATH')) exit;

/**
 * Storage-layer only. Name reservation, collision handling, token
 * generation, and score validation live in a later submission-layer phase —
 * see "Explicitly Out of Scope" in DATABASE.md.
 *
 * $wpdb->prepare() null-as-NULL support (used for optional session_id /
 * metadata below) requires WordPress 6.2+.
 */
class Waterpark_Leaderboard_Score_Repository {

    protected function table() {
        return Waterpark_Leaderboard_DB::table_name();
    }

    // Upserts the player's best score. Only moves score/created_at forward —
    // see "Storage Model: One Row Per Player" in DATABASE.md.
    public function upsert_score($game_key, $token, $player_name, $score, $session_id = null, $metadata = null) {
        global $wpdb;
        $table = $this->table();

        return $wpdb->query($wpdb->prepare(
            "INSERT INTO {$table} (game_key, token, player_name, score, created_at, session_id, metadata)
             VALUES (%s, %s, %s, %d, UTC_TIMESTAMP(), %s, %s)
             ON DUPLICATE KEY UPDATE
                 score      = IF(VALUES(score) > score, VALUES(score), score),
                 created_at = IF(VALUES(score) > score, VALUES(created_at), created_at)",
            $game_key,
            $token,
            $player_name,
            $score,
            $session_id,
            $metadata
        ));
    }

    public function name_taken($game_key, $player_name) {
        global $wpdb;
        $table = $this->table();

        $existing = $wpdb->get_var($wpdb->prepare(
            "SELECT id FROM {$table} WHERE game_key = %s AND player_name = %s LIMIT 1",
            $game_key,
            $player_name
        ));

        return $existing !== null;
    }

    // Plain insert for a brand-new claim — never upsert_score() here. A name
    // collision must surface as a failed insert against idx_game_name so the
    // caller retries with a new suffix, not silently update a stranger's row.
    public function insert_new($game_key, $token, $player_name, $session_id = null, $metadata = null) {
        global $wpdb;

        $result = $wpdb->insert(
            $this->table(),
            array(
                'game_key'    => $game_key,
                'token'       => $token,
                'player_name' => $player_name,
                'score'       => 0,
                'created_at'  => current_time('mysql', true),
                'session_id'  => $session_id,
                'metadata'    => $metadata,
            ),
            array('%s', '%s', '%s', '%d', '%s', '%s', '%s')
        );

        return $result !== false;
    }

    public function get_by_token($game_key, $token) {
        global $wpdb;
        $table = $this->table();

        return $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM {$table} WHERE game_key = %s AND token = %s",
            $game_key,
            $token
        ));
    }

    public function get_score($id) {
        global $wpdb;
        $table = $this->table();

        return $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM {$table} WHERE id = %d",
            $id
        ));
    }

    // Every claimed name for the game — backs the naming screen's reel
    // avoidance (see class-rest-controller.php's /names route). Not
    // paginated: this scales with distinct players, not runs, so a season
    // promo's whole roster is still a cheap single-column select.
    public function get_all_names($game_key) {
        global $wpdb;
        $table = $this->table();

        return $wpdb->get_col($wpdb->prepare(
            "SELECT player_name FROM {$table} WHERE game_key = %s",
            $game_key
        ));
    }

    public function get_leaderboard($game_key, $limit = 50) {
        global $wpdb;
        $table = $this->table();

        return $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM {$table}
             WHERE game_key = %s
             ORDER BY score DESC, created_at ASC
             LIMIT %d",
            $game_key,
            $limit
        ));
    }

    public function get_player_rank($game_key, $score) {
        global $wpdb;
        $table = $this->table();

        $higher = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM {$table} WHERE game_key = %s AND score > %d",
            $game_key,
            $score
        ));

        return $higher + 1;
    }

    public function delete_score($game_key, $token) {
        global $wpdb;
        $table = $this->table();

        return $wpdb->delete(
            $table,
            array('game_key' => $game_key, 'token' => $token),
            array('%s', '%s')
        );
    }
}
