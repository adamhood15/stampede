<?php
if (!defined('ABSPATH')) exit;

/**
 * Serves the game at /play/ as a bare document — no theme header/footer, no
 * enqueued theme/plugin scripts — gated behind a signed token from
 * Waterpark_Leaderboard_Gate. See ARCHITECTURE.md/DATABASE.md for why: a
 * blank template avoids the load-time/frame-rate cost of everything else
 * WordPress would otherwise attach to the page.
 */
class Waterpark_Leaderboard_Game_Router {

    const QUERY_VAR       = 'waterpark_game';
    // Stores a page ID (not a URL) so this and Waterpark_Leaderboard_Gate_Page
    // share one source of truth for "which page is the gate."
    const GATE_PAGE_OPTION = 'waterpark_gate_page_id';

    // Re-enabled (2026-08-27) — Adam's call to bring the token gate back.
    // The gate, the REST route, and the gate-page snippet were untouched
    // since being switched off; flip to false to serve /play/ ungated again.
    // Temporarily false (2026-09-02) so the leaderboard migration's
    // rollout verification can hit /play/ directly on staging while the
    // gate funnel is still unwired (waterpark_gate_page_id unset) — flip
    // back to true once verification is done.
    const GATE_ENABLED = false;

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

        if (self::GATE_ENABLED) {
            $token = isset($_GET['t']) ? $_GET['t'] : '';

            if (!Waterpark_Leaderboard_Gate::validate_token($token)) {
                wp_safe_redirect(self::gate_page_url());
                exit;
            }
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

    protected static function gate_page_url() {
        $page_id = (int) get_option(self::GATE_PAGE_OPTION);
        $url     = $page_id ? get_permalink($page_id) : false;
        return $url ? $url : home_url('/');
    }
}
