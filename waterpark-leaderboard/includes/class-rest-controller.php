<?php
if (!defined('ABSPATH')) exit;

/**
 * Public REST routes. The leaderboard routes (/claim, /submit, /leaderboard,
 * /rank, /names) moved to leaderboard-service/ on Railway — see
 * /Users/Adam.Hood/.claude/plans/lazy-rolling-matsumoto.md. All that's left
 * here is the gate-token route the signup funnel needs, which stays in
 * WordPress since it's entangled with WS Form/Mailchimp and is low-volume
 * (one hit per player, not per-run).
 */
class Waterpark_Leaderboard_REST_Controller {

    const NAMESPACE_ = 'waterpark-leaderboard/v1';

    public static function register_routes() {
        register_rest_route(self::NAMESPACE_, '/gate-token', array(
            'methods'             => 'GET',
            'callback'            => array(__CLASS__, 'gate_token'),
            'permission_callback' => '__return_true',
        ));
    }

    // Powers the gate page's fetch-token-then-redirect-on-submit flow — see
    // Waterpark_Leaderboard_Gate for what the token actually proves.
    public static function gate_token(WP_REST_Request $request) {
        return new WP_REST_Response(array('token' => Waterpark_Leaderboard_Gate::issue_token()), 200);
    }
}
