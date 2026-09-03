# Open Work

Rules for working on this code live in [AGENTS.md](AGENTS.md); architecture
detail is in [ARCHITECTURE.md](ARCHITECTURE.md); leaderboard schema/status is
in [DATABASE.md](DATABASE.md).

## Leaderboard / database

- **Clear the Kinsta dev table's test data** before that environment is used
  for anything real — it has accumulated dozens of claimed names/scores from
  verification sessions, including at least one live "Bubbly Jellyfish"
  entry created by a simulated-offline test that went through for real.
- ~~**Name-pool squatting** — a script could claim large swaths of the
  9,900-word pool with no gameplay~~ — partially addressed (2026-08-28), a
  cheat-audit finding. `Waterpark_Leaderboard_Claim_Cleanup` (hourly
  WP-Cron) releases any claim still unplayed (`score = 0`) after a 48-hour
  grace window; real plays are never touched. Doesn't stop squatting within
  that window, just stops it being permanent — see DATABASE.md.
- **Claim screen renders over the full board** — reels and "Use This Name"
  sit on top of the top-50 list, reads busy. Alternative: a dedicated claim
  view that swaps to the board after.
- **Results-card wording:** "You Survived It" is shown for every run now
  that every run ends in a wipeout — accurate when the card could be
  reached mid-run, not any more. Not changed — not yet raised with the user.

## WordPress hosting / go-live

Live on staging (`env-typhoontexasnew-dev.kinsta.cloud`), not pushed to the
live site — **do not push to live until this section clears.** Deploy via
`tools/deploy.sh` (rewrites asset paths + the `API` constant, copies
`assets/` to `waterpark-leaderboard/game-assets/`, normalizes permissions).

**Route slug (2026-09-02):** the game route is
`houston/stampede-wild-rush/play/`, not the bare `/play/` used everywhere
below as shorthand — `class-game-router.php`'s rewrite rule and
`class-gate-page.php`'s redirect target both match this now. Matches the
real production path; verified end-to-end on staging via
`env-typhoontexasnew-dev.kinsta.cloud/houston/stampede-wild-rush/play/`.

**Funnel design (2026-08-27, supersedes the 2026-08-25 no-gate call):** the
token gate is back on. `/play/` (`Waterpark_Leaderboard_Game_Router`, blank
`template_include`, no theme/plugin chrome) now requires a valid signed
token (`?t=...`) or redirects to the configured gate page — flip
`GATE_ENABLED` to `false` to go back to the plain-URL design. The gate was
originally built and verified end-to-end (2026-08-25), then scrapped in
favor of a plain "Play Now" button because a shared/bookmarked `/play/` link
worked for anyone indefinitely; it's been recreated from that same design
(`Waterpark_Leaderboard_Gate` — HMAC-signed, 15-minute tokens; the
`/gate-token` REST route; `Waterpark_Leaderboard_Gate_Page`'s
fetch-token/redirect snippet, printed via `wp_footer` on whichever page is
set as `waterpark_gate_page_id`).

**Gate is live on staging (2026-09-02).** Kinsta overwrote staging with
production mid-migration (to transfer the form page built directly in
production), which wiped the plugin and required a full redeploy + host-key/
SSH-key re-registration. Since then: `waterpark_gate_page_id` is set to
`8663` (`houston/stampede-wild-rush/`, published), `GATE_ENABLED` is back to
`true`, and the WS Form on that page has a "Run Javascript" submit action
calling `window.WaterparkGate.redirectToGame()` — so the redirect-on-submit
wiring is done, not just the fetch-token half. Verified end-to-end via
`tools/gate-check.js`: no token redirects to the landing page, a valid token
boots the game clean (no theme chrome).

Before pushing to live:
- **`tools/deploy.sh` only targets the Kinsta dev path/site.** Needs
  a production target (or a defined manual equivalent) before it can be used
  for the live push.
- **End-to-end funnel test with the real form:** submit it → confirm
  Mailchimp gets the subscriber → confirm the redirect fires → confirm it
  lands on a working `/play/`. `gate-check.js` proves the token/redirect
  mechanics but drives `redirectToGame()` directly, not a real form submit —
  still worth a manual pass through the actual WS Form.
- **Leaderboard test data must not be copied to live** — see the dev-table
  item above; clear it, don't carry it over.
- **Full screen-by-screen smoke test on the actual live domain** once
  copied (loading → naming → play → wipeout/win → leaderboard), not just a
  spot-check.
- **Re-confirm the leaderboard's cross-origin (CORS) calls work from the real
  live domain** — the leaderboard backend moved off WordPress onto Railway
  (`leaderboard-service/`, see `lazy-rolling-matsumoto.md`), so `Board`'s
  `API` constant is now an absolute cross-origin URL, not a relative path.
  The Railway service's CORS allowlist needs to include the real production
  domain (`typhoontexas.com`), not just the Kinsta staging origin — confirm
  this once live rather than assuming the staging allowlist entry carries
  over.
- **Flush WP rewrite rules once manually right after the live push** — the
  routes-version check should handle this automatically, but it's cheap
  insurance for a first launch.
- **Robots/indexing:** confirm `/play/` isn't indexable/crawlable. Lower
  stakes now that the gate is back on (an indexed link without a valid token
  just redirects), but a bookmarked/shared link from *within* a valid
  15-minute token window would still work until it expires — worth
  confirming crawlers can't pick one up mid-window.
- **Confirm the rollback path** before pushing — know what "revert" looks
  like if something's wrong post-launch.
- **Re-check server-side REST latency against production once live** —
  staging (2026-09-01 investigation) showed ~2.2-3.5s TTFB on every route
  tested, including bare `/wp-json/` and the homepage, not just the
  leaderboard plugin's own routes. Root-caused to two contributors: (1)
  Kinsta disables the staging environment's real system cron
  (`crontab -l` confirms this, restored automatically on push-to-live) while
  `DISABLE_WP_CRON` isn't set in `wp-config.php` and two cron hooks
  (`action_scheduler_run_queue`, `rvy_mail_buffer_hook`) sit permanently
  overdue — so WP core's per-request loopback `spawn_cron()` check fires on
  nearly every hit. Confirmed via a temporary `DISABLE_WP_CRON` test
  (reverted immediately after, checksum-verified clean): TTFB dropped from
  ~2.5-3.5s to ~1.3-1.7s. This part should resolve on its own once live
  cron is restored. (2) The remaining ~1.3-1.7s baseline is unexplained by
  anything in `waterpark-leaderboard`'s own code — `get_leaderboard()`'s
  query is a clean indexed range scan (`idx_game_score`), no blocking
  network/filesystem calls exist in the plugin — and instead points at
  hosting/plugin-stack factors that may or may not carry over to
  production: no persistent object cache (no `object-cache.php` drop-in;
  worth checking whether Kinsta's Redis add-on is enabled), and a heavy
  active-plugin stack bootstrapping every request (Wordfence, Oxygen, ACF
  Pro, WPO365, ws-form-pro + Mailchimp + Action Scheduler, Yoast SEO).
  Re-measure this exact comparison (bare `/wp-json/`, `/leaderboard`,
  homepage TTFB) against `typhoontexas.com` once live — staging's numbers
  aren't reliable evidence for production's actual latency.
- ~~**Re-confirm the zero-auth/no-rate-limit leaderboard REST routes are
  still an acceptable risk**~~ — partially addressed (2026-08-28). A cheat
  audit found `/submit` accepted any integer score with no validation and
  neither `/claim` nor `/submit` had rate limiting, so a single request (or
  script) could forge the board. Fixed: a plausibility ceiling on submitted
  scores and per-IP rate limiting on both routes (see DATABASE.md). `/leaderboard`,
  `/rank`, `/names` remain zero-auth, unlimited reads — still fine, they
  can't alter the board. Re-confirm the new limits hold at real
  marketing-campaign volume once live, not just test volume.

## Loading optimization

Sprite/audio compression re-landed (2026-08-25): 48.6 MB → 21.5 MB across
all PNGs and MP3s under `assets/`. Method — `tools/compress-assets.sh`:
`oxipng -o4` (lossless) then `pngquant --quality=85-100 --skip-if-larger`
(only applied when it can hit that quality floor *and* beats the lossless
size, so already-optimized files like `background-western.png`/`sun.png`
from the prior pass are left alone) for PNGs; `lame -V2`/`-V3` re-encode for
MP3s already sitting well above what a short game clip needs (>=224kbps
only — files already at a sane bitrate are left untouched to avoid
transcoding generation loss). Spot-checked several of the largest sprites
(season-pass sheet, tunnel rings, snowman) via side-by-side screenshot —
no visible banding or artifacting. Re-run the script after adding new
assets.

- **The progress bar counts files, not bytes**, so on a slow connection most
  files finish fast and it sits near-full through the one big backdrop.
  Weighting each file by its known byte size would fix the feel without
  needing real progress events.
- **Defer assets the title screen doesn't need** — the loader still blocks
  on all 63 files; `game-over.mp3` isn't needed until someone dies, nor win
  art until they win.
- **Test throttled, not on Wi-Fi** — not yet done.
- `assets/sprites/chute/tunnel-ring-inner.png` is now compressed (262 KB)
  but still unreferenced by `index.html` — check whether it feeds a
  registration-relevant sprite before wiring it up.

## Blocked / needs a decision

- **80° plunge set-piece.** The fixed-pitch camera tops out near 31.7°; at
  80° the vanishing point sits ~4,764px below the horizon. Needs new art
  (steep rib, crest lip, plunge pose, runout splash). A 45° version was
  built and reverted at the user's request. **Agree camera pitch as a
  standalone change before reopening.**

## Mobile UI/UX audit (2026-08-20 findings, nothing changed yet)

**Medium priority**
- **How-to-Play is one long scroll with no cue** that ~2 more screens of
  content sit below the fold — a first-time player can miss the actual
  control instructions.
- **Leaderboard placeholder/dev data is suspiciously uniform** — worth
  seeding more varied data before this is shown to a real player (also see
  "clear the Kinsta dev table" above).

**Low priority / polish**
- Control-legend icons are still keyboard key-cap glyphs even when the copy
  has swapped to touch wording — icon and text send mixed signals on
  mobile.
- `user-scalable=no` disables pinch-zoom everywhere including text-heavy
  screens — standard for a game, but worth naming as a deliberate tradeoff.

## Housekeeping

- **~39 MB of unreferenced files in `assets/`** — master sprite sheets and
  superseded art. Source material the user keeps on purpose — not a cleanup
  to make unasked.

## Parked / declined (do not re-raise unprompted)

- Cow/snowman/wave rail clipping — same, after four layering attempts.
