# Open Work

Rules for working on this code live in [AGENTS.md](AGENTS.md); architecture
detail is in [ARCHITECTURE.md](ARCHITECTURE.md); leaderboard schema/status is
in [DATABASE.md](DATABASE.md).

## Leaderboard / database

- **Revert `Board`'s `API` constant to the relative path** before
  `index.html` is served from WordPress — it currently points at the Kinsta
  dev site absolute URL (see [DATABASE.md](DATABASE.md#front-end-integration-board-in-indexhtml)).
- **Get `index.html` into an Oxygen Builder code block.** Needs asset-path
  rewriting (relative `assets/...` references currently assume same-path
  hosting) and a decision on code block vs. plugin-enqueued script.
- **Full word-by-word audit of the 10,000-pair pool** — the 120 words added
  in the 100×100 expansion have only been screened by Claude, not read
  word-by-word by the user the way the original 80 were. This audit is the
  entire safety argument for the closed-set naming approach.
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
  Life, Whirlpool, Season Pass) now renders at the same height (`LETTER_H`),
  and every pickup's own glow now reaches the same fraction of its icon's
  height (`SUN_R` = 0.85, shared by every glow's own reach constant). See
  `LETTER_H`'s comment in `index.html` for the full rationale.
- 


## Performance

- **Mobile render cost never profiled on a device.** Suspected cost
  centres: ~120 water streaks, 12 rail polygons rebuilding gradients every
  frame, the park aerial rescaled every frame, ribs drawn from `dz 0.85`.
  Cheapest untaken lever: `DPR = Math.min(2, devicePixelRatio)` — capping at
  1.5 would cut fill-rate ~44% on a 2× phone. Profile before changing it.

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
