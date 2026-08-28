# Open Work

Rules for working on this code live in [AGENTS.md](AGENTS.md); architecture
detail is in [ARCHITECTURE.md](ARCHITECTURE.md); leaderboard schema/status is
in [DATABASE.md](DATABASE.md).

## Leaderboard / database

- ~~**Revert `Board`'s `API` constant to the relative path**~~ — resolved
  (2026-08-25). `tools/deploy-staging.sh` rewrites it to the relative
  `/wp-json/waterpark-leaderboard/v1` path for the copy that actually ships
  to WordPress; the repo's own `index.html` keeps the absolute Kinsta dev
  URL for local testing against `python3 server.py`.
- ~~**Get `index.html` into an Oxygen Builder code block.**~~ — superseded
  (2026-08-25). Went with a WP `template_include` blank-template route at
  `/play/` instead — no theme/plugin script baggage, no editor fighting a
  huge inline `<script>`. See "WordPress hosting / go-live" below.
- ~~**Full word-by-word audit of the 10,000-pair pool**~~ — resolved
  (2026-08-27). Adam reviewed all 120 expansion words via an interactive
  checklist artifact (18 pre-flagged by Claude for tone/trademark/
  connotation, same categories as the original 2026-08-18 audit). Only
  `Slippery` was cut; see DATABASE.md's "Word pool" section for the full
  kept/cut breakdown. Pool is now 99×100 = 9,900 combinations.
- **Clear the Kinsta dev table's test data** before that environment is used
  for anything real — it has accumulated dozens of claimed names/scores from
  verification sessions, including at least one live "Bubbly Jellyfish"
  entry created by a simulated-offline test that went through for real.
- **Claim screen renders over the full board** — reels and "Use This Name"
  sit on top of the top-50 list, reads busy. Alternative: a dedicated claim
  view that swaps to the board after.
- **Results-card wording:** "You Survived It" is shown for every run now
  that every run ends in a wipeout — accurate when the card could be
  reached mid-run, not any more. Not changed — not yet raised with the user.

## WordPress hosting / go-live

Live on staging (`env-typhoontexasnew-dev.kinsta.cloud`), not pushed to the
live site — **do not push to live until this section clears.** Deploy via
`tools/deploy-staging.sh` (rewrites asset paths + the `API` constant, copies
`assets/` to `waterpark-leaderboard/game-assets/`, normalizes permissions).

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

**Not yet done for this gate to work live:**
- `waterpark_gate_page_id` must be set (which WP page mints/hosts the
  token-fetch snippet) — nothing sets this option yet.
- The redirect-on-submit half of the gate-page snippet is still unwired to a
  real WS Form submit event (see `class-gate-page.php`'s own note) —
  currently only exposes `window.WaterparkGate.redirectToGame()` for
  manual/console use.
- `tools/gate-check.js` (recreated 2026-08-27) verifies the deployed gate
  end-to-end but hasn't been run against the current staging deploy yet.

Before pushing to live:
- **`tools/deploy-staging.sh` only targets the Kinsta dev path/site.** Needs
  a production target (or a defined manual equivalent) before it can be used
  for the live push.
- **The signup page needs to be set as the gate page** (`waterpark_gate_page_id`)
  and its WS Form submit event wired to call `window.WaterparkGate.redirectToGame()`
  — nothing currently connects form submission to the redirect.
- **End-to-end funnel test once that's wired:** submit the real form →
  confirm Mailchimp gets the subscriber → confirm the button appears →
  confirm it lands on a working `/play/`.
- **Leaderboard test data must not be copied to live** — see the dev-table
  item above; clear it, don't carry it over.
- **One more asset-permissions sweep post-copy.** The deploy script now
  normalizes permissions on every run — caught a real bug this exact way
  (2026-08-25): `sound-effects/letter-collect/` was `700` and silently
  404'd only under nginx's different user, invisible locally under
  `python3 server.py`'s same-user access. Still worth a final full pass
  after any copy that doesn't go through this script.
- **Full screen-by-screen smoke test on the actual live domain** once
  copied (loading → naming → play → wipeout/win → leaderboard), not just a
  spot-check.
- ~~**Real-device frame-rate profile still hasn't been done**~~ — resolved
  (2026-08-27), see "Performance" below. Profiled on two real Android
  phones, flat 60fps both runs. Still only Android Chrome tested (see
  AGENTS.md) — live traffic won't be limited to that.
- **Re-confirm the leaderboard REST calls work same-origin on the real live
  domain** — should be automatic (the `API` constant is a relative path),
  confirm rather than assume.
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
- **Re-confirm the zero-auth/no-rate-limit leaderboard REST routes are still
  an acceptable risk** at real marketing-campaign volume — accepted as fine
  for a promo at test volume (see DATABASE.md), but live traffic is a
  different order of magnitude than anything thrown at it so far.

## Rendering bugs

- ~~**Sky disappearing at extreme roll angles.**~~ — fixed (2026-08-25).
  Neither of the two leading suspects on file: the sky gradient/sun/clouds
  were never actually losing coverage or getting swung off past `OVER`'s
  margin. The real cause was `speedLines()`'s always-on ambient vignette
  (`rgba(30,48,72,...)`, the same radial darkening used for boost/tunnel):
  its `createRadialGradient` is centred on `W/2, horizon` — the *exact* point
  camera roll (`ctx.rotate` in `render()`) pivots about — so rolling it is
  mathematically a no-op (every screen pixel sits at a roll-invariant
  distance from that centre). It was still being painted through the full
  rotated transform with an `OVER`-margined oversized rect anyway, purely by
  copying the backdrop's overdraw pattern without checking whether this
  particular gradient needed it. Confirmed via headless Chrome
  (`Emulation.setDeviceMetricsOverride` at a wide landscape size, forcing
  `travelled` to a near-peak-roll `curveX` gradient z) that the unmodified
  code visibly blacked out the sky/sun/cloud band at extreme roll in
  landscape, and that a fresh load of the edited file does not. Fix: draw
  the vignette's gradient creation *and* fill outside the rolled transform
  (`ctx.save()`/`ctx.setTransform(DPR,0,0,DPR,0,0)`/`ctx.restore()`, plain
  `fillRect(0,0,W,H)`, no `OVER` margin needed since nothing here moves when
  the camera banks) — `boostRush()`, which *is* roll-dependent (rides with
  the rider), stays inside the rotated block as before, called after the
  `restore()`. Zero visual change at rest (proven both algebraically and by
  a flat-roll before/after screenshot); resolves the reported darkening at
  peak roll in a wide viewport, and is strictly cheaper (one `W x H` fill
  instead of one ~1.5x-oversized rotated one).

## Verification sweeps needed

- ~~**Full viewport audit**~~ — done (2026-08-25). `tools/viewport-audit.js`
  walks every screen (loading, title, claim-name, how-to-play, in-run HUD,
  paused, wipeout/results win+lose, win reveal, leaderboard) at 320, 360,
  390, 412, 768, and desktop widths with worst-case content (longest reel
  name pair, 9-digit score/coins/distance, all 8 letters lit, 50-row
  leaderboard), flagging `getBoundingClientRect()` edge overflow and real
  `scrollWidth > clientWidth` bursts. Found and fixed one real bug: `#stats`
  had no width cap, so worst-case figures grew the results card's stat row
  past both screen edges at ≤412px — fixed with `width:100%` on `#stats`.
  Two other flags are confirmed cosmetic, not bugs (the loading bar's handle
  straddling its track at 0%, and the win-reveal sign's rotated drop-shadow).
- ~~**Sprite animation audit**~~ — done (2026-08-25). `tools/sprite-size-audit.js`
  measures every registered rider-animation frame's actual on-screen apparent
  size (opaque-pixel silhouette area, not raw PNG dimensions — a red herring,
  since e.g. season-pass_08/09 differ in canvas size on purpose). Fixed four
  frames whose decorative canvas padding (swoosh/burst/thrown-card art) was
  shrinking Typhoon's rendered height via `dh = dw * (img.height/img.width)`:
  `SEASONPASS_REG[3]`/`[8]` (season-pass_04/_09), `DIE_REG[2]` (die_03),
  `FLIP_REG[2]`/`[3]` (backflip_03/04). Verified live via
  `tools/seasonpass-outro-shrink-check.js`'s real `drawImage()` capture.
  `DUCK_REG`'s intentional duck-tuck shrink and `SEASONPASS_REG[5]`
  (season-pass_06's resting pose) left as-is — not padding artifacts.
  Letters and power-ups also audited (`tools/powerup-letter-size-audit.js`):
  every pickup's `*_H` was its own hand-tuned literal (a deliberate rarity
  hierarchy — Season Pass documented as "the biggest power-up... by design")
  which read as visibly inconsistent sizes; flattened at Adam's explicit
  request (2026-08-25) so every pickup (letters, Fast Pass, Souvenir, Extra
  Life, Whirlpool, Season Pass) now renders at roughly the same on-screen
  footprint, and every pickup's own glow now reaches the same fraction of
  its icon's height (`SUN_R` = 0.85, shared by every glow's own reach
  constant). Matching every `*_H` to the same literal (`LETTER_H`) got the
  first four right but missed Season Pass: season-pass.png's native canvas
  is unusually wide-and-flat (200x126, vs. the others' roughly square-to-tall
  canvases), so matching HEIGHT alone let its WIDTH balloon out unchecked —
  read as "considerably bigger" on a real device despite an identical `H`.
  Caught after the fact by re-running the same audit's `footprintArea`
  metric (bounding-box area, not just height) against a live screenshot;
  fixed by solving `SEASONPASS_H` (0.393, not `LETTER_H`) for the footprint
  the other four icons actually average, not for a matching height. See
  `SEASONPASS_H`'s own comment in `index.html` for the full rationale.
- 


## Performance

- ~~**Mobile render cost never profiled on a device.**~~ — resolved
  (2026-08-27). Profiled on two real Android phones via an opt-in on-screen
  HUD (`?debugPerf` / `localStorage.stampede.debug.perf`, `PERF_DEBUG` in
  `index.html`, verified by `tools/perf-hud-check.js`), played over GitHub
  Pages (`adamhood15.github.io/stampede`) since Adam's WiFi firewall blocked
  the LAN dev server. Both runs held a flat **60fps avg/p95, ~16.7ms frame
  time** — steady-state cost is not a problem. Each run had a handful of
  isolated jank frames (11 over one run, 8 over a ~2-minute run) with one
  worst-case spike (151.7ms, then 66.7ms) — but the worst frame's own
  captured context (`ents`, `streaks`, `state`) showed it did NOT correlate
  with entity/streak count (one spike happened at `ents=10`, *below* that
  run's own max of 18), which rules out the original "~120 water streaks /
  rail-polygon gradients" suspicion as the cause. Adam confirmed it felt
  "extremely smooth and great" while playing. **Conclusion: the DPR cap
  (`Math.min(2, devicePixelRatio)` → 1.5) is not warranted** — it would
  trade real visual quality for a steady-state cost problem the data doesn't
  show. The rare isolated stalls read as GC pauses or an OS-level blip, not
  a rendering-cost issue; pinning the exact cause further would need real
  GC/heap profiling (Chrome remote debugging over USB), which `adb` isn't
  set up for on this machine — not pursued further since the game already
  reads as fully smooth in practice.

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
