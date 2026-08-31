<?php
if (!defined('ABSPATH')) exit;

/**
 * Fixed-window per-IP rate limiting for the leaderboard's public write
 * routes (`/claim`, `/submit`). Backed by transients — no new
 * infrastructure needed at this traffic level.
 *
 * This is abuse-dampening, not a security boundary: the read-then-write on
 * the transient isn't atomic, and `X-Forwarded-For` is client-supplied and
 * only trustworthy if Kinsta's edge strips/overwrites it before the request
 * reaches PHP (unverified — confirm before leaning on this for anything
 * beyond throttling a single noisy source). A determined attacker rotating
 * IPs walks straight through it. Goal is only to stop a single script from
 * hammering these routes, per cheat-audit finding #2 (2026-08-28).
 */
class Waterpark_Leaderboard_Rate_Limiter {

    public static function client_ip() {
        if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
            $parts = explode(',', $_SERVER['HTTP_X_FORWARDED_FOR']);
            return trim($parts[0]);
        }

        return isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : 'unknown';
    }

    // Returns true if this call is within budget for the window (and counts
    // it), false if the bucket is already exhausted.
    public static function allow($bucket, $max_requests, $window_seconds) {
        $key   = 'wplb_rl_' . md5($bucket . '|' . self::client_ip());
        $count = get_transient($key);

        if ($count === false) {
            set_transient($key, 1, $window_seconds);
            return true;
        }

        if ($count >= $max_requests) {
            return false;
        }

        set_transient($key, $count + 1, $window_seconds);
        return true;
    }
}
