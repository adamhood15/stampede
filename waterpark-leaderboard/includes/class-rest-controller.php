<?php
if (!defined('ABSPATH')) exit;

/**
 * Public REST routes — no nonce, no rate limit, no shared secret, by
 * explicit decision (2026-08-20): matches the score-forgery risk
 * DATABASE.md already accepts for this park-promo use case. Revisit only if
 * the board actually gets gamed.
 *
 * game_key is always the plugin's own default, never taken from the client
 * — there is no multi-game UI yet, and accepting an arbitrary game_key would
 * let a caller write into namespaces nothing else uses.
 */
class Waterpark_Leaderboard_REST_Controller {

    const NAMESPACE_ = 'waterpark-leaderboard/v1';

    // Cheat-audit finding #1 (2026-08-28): /submit took any integer with no
    // gameplay validation, so a forged score topped the board with a single
    // request. This ceiling doesn't validate a score is real — it just
    // rejects what no real run could plausibly reach, per runScore()'s own
    // ceiling comment in index.html: an unsteered bot banks ~0.57 coins/sec
    // (measured 2026-08-18), a skilled player roughly 5x that, ~28 score/sec.
    // 100,000 is a generous ~1-hour single-sitting cap, not a tight bound —
    // tune it if legitimate marathon runs ever get close.
    const MAX_PLAUSIBLE_SCORE = 100000;

    public static function register_routes() {
        register_rest_route(self::NAMESPACE_, '/claim', array(
            'methods'             => 'POST',
            'callback'            => array(__CLASS__, 'claim'),
            'permission_callback' => '__return_true',
            'args'                => array(
                'adjective'  => array('required' => true, 'type' => 'string'),
                'noun'       => array('required' => true, 'type' => 'string'),
                'session_id' => array('required' => false, 'type' => 'string'),
            ),
        ));

        register_rest_route(self::NAMESPACE_, '/submit', array(
            'methods'             => 'POST',
            'callback'            => array(__CLASS__, 'submit'),
            'permission_callback' => '__return_true',
            'args'                => array(
                'token'      => array('required' => true, 'type' => 'string'),
                'score'      => array('required' => true, 'type' => 'integer'),
                'session_id' => array('required' => false, 'type' => 'string'),
            ),
        ));

        register_rest_route(self::NAMESPACE_, '/leaderboard', array(
            'methods'             => 'GET',
            'callback'            => array(__CLASS__, 'leaderboard'),
            'permission_callback' => '__return_true',
            'args'                => array(
                'limit' => array('required' => false, 'type' => 'integer', 'default' => 50),
            ),
        ));

        register_rest_route(self::NAMESPACE_, '/rank', array(
            'methods'             => 'GET',
            'callback'            => array(__CLASS__, 'rank'),
            'permission_callback' => '__return_true',
            'args'                => array(
                'score' => array('required' => true, 'type' => 'integer'),
            ),
        ));

        register_rest_route(self::NAMESPACE_, '/names', array(
            'methods'             => 'GET',
            'callback'            => array(__CLASS__, 'names'),
            'permission_callback' => '__return_true',
        ));

        register_rest_route(self::NAMESPACE_, '/gate-token', array(
            'methods'             => 'GET',
            'callback'            => array(__CLASS__, 'gate_token'),
            'permission_callback' => '__return_true',
        ));
    }

    protected static function game_key() {
        return WATERPARK_LEADERBOARD_DEFAULT_GAME_KEY;
    }

    public static function claim(WP_REST_Request $request) {
        // Cheat-audit finding #2 (2026-08-28): unlimited, unauthenticated
        // /claim let a script squat the whole name pool in seconds. 30/10min
        // per IP is generous enough for a shared park-Wi-Fi NAT (many real
        // players, one IP) while still bounding a scripted claim spree.
        if (!Waterpark_Leaderboard_Rate_Limiter::allow('claim', 30, 600)) {
            return new WP_Error(
                'waterpark_rate_limited',
                'Too many name claims from this connection — try again shortly.',
                array('status' => 429)
            );
        }

        $result = Waterpark_Leaderboard_Name_Pool::claim(
            self::game_key(),
            (string) $request->get_param('adjective'),
            (string) $request->get_param('noun'),
            self::sanitize_session_id($request->get_param('session_id'))
        );

        if (is_wp_error($result)) {
            return $result;
        }

        return new WP_REST_Response($result, 201);
    }

    public static function submit(WP_REST_Request $request) {
        // Cheat-audit finding #2 (2026-08-28): unlimited /submit let a script
        // hammer the board with forged scores. 20/5min per IP is far above
        // what a real player triggers (submit only fires on a new personal
        // best) while bounding an automated flood.
        if (!Waterpark_Leaderboard_Rate_Limiter::allow('submit', 20, 300)) {
            return new WP_Error(
                'waterpark_rate_limited',
                'Too many score submissions from this connection — try again shortly.',
                array('status' => 429)
            );
        }

        $token = (string) $request->get_param('token');
        $score = max(0, (int) $request->get_param('score'));

        // Cheat-audit finding #1 (2026-08-28) — see MAX_PLAUSIBLE_SCORE above.
        if ($score > self::MAX_PLAUSIBLE_SCORE) {
            return new WP_Error(
                'waterpark_score_implausible',
                'Score exceeds what a single run can plausibly reach.',
                array('status' => 422)
            );
        }

        $repository = new Waterpark_Leaderboard_Score_Repository();
        $existing   = $repository->get_by_token(self::game_key(), $token);

        if (!$existing) {
            return new WP_Error(
                'waterpark_unknown_token',
                'No claimed name matches this token.',
                array('status' => 404)
            );
        }

        // player_name is always the already-claimed name — submit can never
        // rename a player. See "Design decisions" in DATABASE.md.
        $repository->upsert_score(
            self::game_key(),
            $token,
            $existing->player_name,
            $score,
            self::sanitize_session_id($request->get_param('session_id'))
        );

        $current = $repository->get_by_token(self::game_key(), $token);

        return new WP_REST_Response(array(
            'token'       => $current->token,
            'player_name' => $current->player_name,
            'score'       => (int) $current->score,
        ), 200);
    }

    public static function leaderboard(WP_REST_Request $request) {
        $limit      = min(100, max(1, (int) $request->get_param('limit')));
        $repository = new Waterpark_Leaderboard_Score_Repository();
        $rows       = $repository->get_leaderboard(self::game_key(), $limit);

        return new WP_REST_Response(array_map(array(__CLASS__, 'format_public_row'), $rows), 200);
    }

    public static function rank(WP_REST_Request $request) {
        $score      = max(0, (int) $request->get_param('score'));
        $repository = new Waterpark_Leaderboard_Score_Repository();

        return new WP_REST_Response(array(
            'rank' => $repository->get_player_rank(self::game_key(), $score),
        ), 200);
    }

    // Powers the naming screen's reel avoidance — every claimed name is
    // already public (it's on the leaderboard), so this exposes nothing new.
    public static function names(WP_REST_Request $request) {
        $repository = new Waterpark_Leaderboard_Score_Repository();

        return new WP_REST_Response($repository->get_all_names(self::game_key()), 200);
    }

    // Powers the gate page's fetch-token-then-redirect-on-submit flow — see
    // Waterpark_Leaderboard_Gate for what the token actually proves.
    public static function gate_token(WP_REST_Request $request) {
        return new WP_REST_Response(array('token' => Waterpark_Leaderboard_Gate::issue_token()), 200);
    }

    // Never expose a row's token to anyone but the caller who already holds
    // it (claim/submit responses) — leaderboard rows are public-read.
    protected static function format_public_row($row) {
        return array(
            'player_name' => $row->player_name,
            'score'       => (int) $row->score,
        );
    }

    protected static function sanitize_session_id($session_id) {
        return $session_id === null ? null : (string) $session_id;
    }
}
