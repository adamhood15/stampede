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
- **Stats cells size independently** — a long Score renders smaller than a
  short Descent beside it (same root cause as the long-number overflow fix,
  `setFigure`, not fixed there either).
- **Results-card wording:** "You Survived It" is shown for every run now
  that every run ends in a wipeout — accurate when the card could be
  reached mid-run, not any more. Not changed — not yet raised with the user.

## Rendering bugs

- **Sky disappearing at extreme roll angles.** Sun, clouds, and the sky
  gradient above the western backdrop disappear when the canvas rolls hard;
  the park aerial stays. Parked, not being worked on.
  - **Not** the missing-`OVER` bug — the sky gradient fill already
    overdraws correctly and is drawn inside the rolled frame.
  - **Leading suspect:** the sun and clouds are placed in *unrotated*
    screen coordinates with no vertical overdraw margin (clouds get a
    horizontal margin only). Roll pivots about the vanishing point, so
    content near the top of the `0..horizon` band swings furthest at
    `ROLL_MAX`. Confirm whether the gradient truly vanishes or is merely
    *covered* — may be two separate faults that happen to show together.

## Verification sweeps needed

- **Full viewport audit** — walk every screen (loading, title, How to Play,
  in-run HUD, paused, wipeout/results, win reveal, leaderboard) at 320, 360,
  390, 412, 768, and desktop widths, with worst-case content (longest name,
  biggest number, all letters lit). A viewport-overflow CDP tool for this
  has existed before (reporting `getBoundingClientRect().right >
  clientWidth` and `scrollWidth > clientWidth` per element) but isn't
  currently in `tools/` — rebuild it there rather than a scratchpad (see
  [ARCHITECTURE.md](ARCHITECTURE.md#tooling)).
- **Jump/duck window tightness** — the user called it "too tight and
  unfair" (item carried over from 2026-08-20). `index.html` now carries a
  `// generous window on purpose` comment at the airborne check, but the
  underlying constants (`lift > 0.28`, `JUMP_DUR = 0.62`) are unchanged from
  when the complaint was raised — confirm with the user whether this was
  actually addressed before treating it as resolved.

## Performance

- **Mobile render cost never profiled on a device.** Suspected cost
  centres: ~120 water streaks, 12 rail polygons rebuilding gradients every
  frame, the park aerial rescaled every frame, ribs drawn from `dz 0.85`.
  Cheapest untaken lever: `DPR = Math.min(2, devicePixelRatio)` — capping at
  1.5 would cut fill-rate ~44% on a 2× phone. Profile before changing it.

## Loading optimization

Sprite/audio compression already landed (26.25 MB → 6.93 MB referenced
sprites; first load is 10.1 MB across 63 files, down from 34.3 MB). Still
open:

- **The progress bar counts files, not bytes**, so on a slow connection most
  files finish fast and it sits near-full through the one big backdrop.
  Weighting each file by its known byte size would fix the feel without
  needing real progress events.
- **Defer assets the title screen doesn't need** — the loader still blocks
  on all 63 files; `game-over.mp3` isn't needed until someone dies, nor win
  art until they win.
- **Test throttled, not on Wi-Fi** — not yet done.
- `assets/sprites/chute/tunnel-ring-inner.png` is still uncompressed
  (731 KB) and still unreferenced by `index.html`. Run it through the same
  `pngquant`/`oxipng` method before wiring it up, and check whether it feeds
  a registration-relevant sprite first.

## Blocked / needs a decision

- **80° plunge set-piece.** The fixed-pitch camera tops out near 31.7°; at
  80° the vanishing point sits ~4,764px below the horizon. Needs new art
  (steep rib, crest lip, plunge pose, runout splash). A 45° version was
  built and reverted at the user's request. **Agree camera pitch as a
  standalone change before reopening.**

## Mobile UI/UX audit (2026-08-20 findings, nothing changed yet)

**High priority**
- **Leaderboard has no quick way out** when opened from the title screen —
  the only exit sits below the entire ranked list (measured 3095px of
  scroll in a 915px viewport). The results-card entry point already
  deep-link-scrolls to the player's row and works well; extend that pattern
  to the title-screen entry.
- **No Android back-button/gesture handling anywhere** — no `popstate` or
  history-state logic exists. Back gesture while a panel is open navigates
  off the page instead of closing the panel. Compounds the item above.

**Medium priority**
- **Failed name-claim is easy to miss** — shows inline error text but no
  visual escalation (shake, color flash, haptic); a player who looked away
  may not notice.
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

- Narrowing `LANE_A` (or shrinking the rider) so riders stop overlapping the
  rail — "leave it as is for now."
- Cow/snowman rail clipping — same, after four layering attempts.
