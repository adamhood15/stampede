<?php
if (!defined('ABSPATH')) exit;

/**
 * Serves the game at /play/ as a bare document — no theme header/footer, no
 * enqueued theme/plugin scripts. Promoted only via a button on the signup
 * page after signup (Adam's call, 2026-08-25) rather than gated by a token —
 * see TODOLIST.md for the access-control tradeoff that implies. A blank
 * template avoids the load-time/frame-rate cost of everything else
 * WordPress would otherwise attach to the page.
 */
class Waterpark_Leaderboard_Game_Router {

    const QUERY_VAR = 'waterpark_game';

    public static function register_routes() {
        add_rewrite_rule('^play/?$', 'index.php?' . self::QUERY_VAR . '=1', 'top');
    }

    public static function query_vars($vars) {
        $vars[] = self::QUERY_VAR;
        return $vars;
    }

    public static function maybe_flush() {
        $installed_version = get_option(WATERPARK_LEADERBOARD_ROUTES_VERSION_OPTION);

        if ($installed_version !== WATERPARK_LEADERBOARD_ROUTES_VERSION) {
            flush_rewrite_rules();
            update_option(WATERPARK_LEADERBOARD_ROUTES_VERSION_OPTION, WATERPARK_LEADERBOARD_ROUTES_VERSION);
        }
    }

    public static function template_include($template) {
        if (!get_query_var(self::QUERY_VAR)) {
            return $template;
        }

        $game_file = WATERPARK_LEADERBOARD_PATH . 'game/index.html';

        if (!file_exists($game_file)) {
            wp_die('Game build not found.', 'Waterpark Leaderboard', array('response' => 500));
        }

        header('Content-Type: text/html; charset=utf-8');
        header('Cache-Control: no-store');
        readfile($game_file);
        exit;
    }
}
