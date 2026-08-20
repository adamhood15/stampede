<?php
if (!defined('ABSPATH')) exit;

class Waterpark_Leaderboard_DB {

    public static function table_name() {
        global $wpdb;
        return $wpdb->prefix . 'stampede_scores';
    }

    public static function install() {
        global $wpdb;

        $table_name      = self::table_name();
        $charset_collate = $wpdb->get_charset_collate();

        // Schema mirrors database-plan.md exactly — see that doc before
        // changing a column or index here. Two spaces after "PRIMARY KEY" is
        // a dbDelta parsing requirement, not a style choice.
        $sql = "CREATE TABLE {$table_name} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            token CHAR(32) NOT NULL,
            player_name VARCHAR(64) NOT NULL,
            score BIGINT UNSIGNED NOT NULL,
            created_at DATETIME NOT NULL,
            game_key VARCHAR(50) NOT NULL,
            session_id VARCHAR(100) NULL,
            metadata LONGTEXT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY idx_game_token (game_key, token),
            UNIQUE KEY idx_game_name (game_key, player_name),
            KEY idx_game_score (game_key, score, created_at),
            KEY idx_game_created (game_key, created_at),
            KEY idx_session (session_id)
        ) {$charset_collate};";

        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        dbDelta($sql);

        update_option(WATERPARK_LEADERBOARD_DB_VERSION_OPTION, WATERPARK_LEADERBOARD_DB_VERSION);
    }

    public static function maybe_upgrade() {
        $installed_version = get_option(WATERPARK_LEADERBOARD_DB_VERSION_OPTION);

        if ($installed_version !== WATERPARK_LEADERBOARD_DB_VERSION) {
            self::install();
        }
    }
}
