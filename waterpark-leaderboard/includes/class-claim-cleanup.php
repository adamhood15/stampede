<?php
if (!defined('ABSPATH')) exit;

/**
 * Releases name claims nobody ever played, so a squatted name recycles back
 * into the pool instead of being lost forever. Cheat-audit finding #3
 * (2026-08-28): /claim is open and unauthenticated, and even with the
 * per-IP rate limit added for finding #2, a patient script (or one spread
 * across IPs) could still work through the 9,900-word pool over time. This
 * bounds how long an unplayed claim can hold a name hostage.
 *
 * Real rows (score > 0) are never touched, no matter how old — see "Data is
 * retained indefinitely" in DATABASE.md. This only reaps rows that were
 * claimed and never played, which were never a real leaderboard entry to
 * begin with.
 */
class Waterpark_Leaderboard_Claim_Cleanup {

    const CRON_HOOK = 'waterpark_leaderboard_cleanup_claims';

    // Grace window before an unplayed claim is released — generous enough
    // that someone claiming a name at the park and coming back the next day
    // still finds it reserved.
    const GRACE_SECONDS = 172800; // 48 hours

    public static function schedule() {
        if (!wp_next_scheduled(self::CRON_HOOK)) {
            wp_schedule_event(time(), 'hourly', self::CRON_HOOK);
        }
    }

    public static function unschedule() {
        $timestamp = wp_next_scheduled(self::CRON_HOOK);

        if ($timestamp) {
            wp_unschedule_event($timestamp, self::CRON_HOOK);
        }
    }

    public static function run() {
        $repository = new Waterpark_Leaderboard_Score_Repository();
        $cutoff     = gmdate('Y-m-d H:i:s', time() - self::GRACE_SECONDS);

        $repository->delete_unplayed_claims_older_than(
            WATERPARK_LEADERBOARD_DEFAULT_GAME_KEY,
            $cutoff
        );
    }
}
