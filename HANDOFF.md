# Handoff — `index.html`

"Typhoon Texas — Buckaroo Run": a single-file HTML5 canvas water-slide runner.
Everything (markup, CSS, game) is in one file, ~4,535 lines. Assets load from
`assets/` as real files.

**Start with [`AGENTS.md`](AGENTS.md)** — the short operating brief, read every
session. This file is the long form behind it: architecture in depth, the full
lessons list, and the open-work queue. Where the two overlap, AGENTS.md is the
summary and this is the detail; if they ever disagree, this file is the one that
went stale.

The `finger-slide-feature` experiment (`index copy.html`) that earlier versions
of this document described **merged into `index.html` long ago** and the file is
gone. Everything below describes `index.html` on `main` unless it says otherwise.

## Standing instructions from the user

**These now live in [`AGENTS.md`](AGENTS.md)** — do not duplicate them here, or
the two copies will drift. In brief: ask rather than assume, measure before
coding, plan before structural edits, DRY, explicit variable names, comments
explain *why* not *what*, check mobile viewports on every UI change, and confirm
before committing.

## Running it

```
python3 server.py          # pass a port as the first argument to change it
```

`server.py` already does what phone testing needs: it binds `0.0.0.0` (a
loopback bind is invisible to the phone), sends `Cache-Control: no-store`, and
prints both a localhost URL and the LAN URL to type into the phone. The
scratchpad `serve_copy.py` that earlier versions of this document referred to is
obsolete — it existed to serve `index copy.html`, which no longer exists.

Use the server, not `file://` — `fetch` fails on `file://` and audio silently
falls back to a second code path (see Audio).

A cached page cost an hour once: the steering was reported broken when the phone
was simply running the previous build. Confirm the request appears in the
server log before debugging the code.

## Architecture

### Rendering: painter's algorithm only
Canvas 2D has **no z-index and no depth buffer**. Layering is purely draw-call
order. Any "z-index" request means reordering draws. The user has been told this.

Projection is in `project(wx, wy, dz)`: `s = focal/dz`, `x = W/2 + (wx-camX)*s`,
`y = horizon + (wy-camY)*s`.

The track is analytic, not baked: `curveX(z)` and `curveY(z)` are sums of sines.
Anything needing track geometry calls these. Two consequences:
- On-screen turn sharpness is the **gradient**, `≈ sum(amp × freq) × focal` — not
  amplitude. "More energetic turns" means raising frequency, not amplitude.
- The track is infinite and stateless; there is no level data.

Camera roll (`ctx.rotate` about the vanishing point) is driven off the lateral
gradient, `ROLL_K = 0.50` clamped to `ROLL_MAX = 0.27`. Because rolling exposes
bare canvas at the corners, every full-screen fill must overdraw by `OVER`
(`= max(W,H) * 0.25`). **A fill of `0,0,W,H` inside the rolled frame is a bug** —
that caused visible diagonal seams once already.

### Draw order inside `chute()`
```
chuteBacking()  ->  ribs / lane guides / water (far to near)
                ->  rimRails()
                ->  tunnels (own pass)
                ->  all entities far to near (incl. cow / yeti)
```
`chuteBacking()` exists because gaps between ribs otherwise showed sky.
Tunnels get their own pass and must apply `farFade()` per ring, or they draw
beyond the faded-out chute (that was a regression).

### Steering — free slide

`lane` used to be an integer in
`{-1,0,1}`; it is now a **continuous float in the same units**. Everything
downstream already multiplied it by `LANE_A`, so the geometry, camera bank and
rider tilt needed no change at all. Obstacles and pickups still *spawn* on the
three whole-numbered lanes — the course reads exactly as before, only the rider
is free.

What did have to change:

- **Collision can no longer ask "same lane?"** It asks "close enough?" against
  `LANE_PICK = 0.55` (pickups) and `LANE_HIT = 0.40` (obstacles). Deliberately
  unequal: coins reach further than the rider so a line can be hoovered, while
  the gap between two rider-obstacles stays genuinely threadable. Equal widths
  were tried first and made the chute feel narrower than it looks.
- **Collision reads `laneA / LANE_A`, not `lane`** — the eased angle the rider is
  *drawn* at, not the input target. Reading the target lets a hit land a tenth of
  a second before the sprite arrives, which is the one thing a stepless slide
  must not do.
- **The lean pose is derived from crossing speed**, since no discrete move event
  exists to trigger it. It reads a *smoothed* velocity (`leanV`, eased at dt*9)
  against `LEAN_RATE = 1.1` lane units/s. The raw frame-to-frame figure is
  useless here: an exponential ease answers any target change with a first-frame
  spike of `delta*13`, so an 8px thumb correction momentarily reads 1.17 lanes/s
  and the pose strobed on every trim. Smoothed, that nudge peaks at 0.39 while a
  half-lane jab reaches 2.2 and a full crossing ~4.
- `MOVE_DUR` is now unused, kept only as the record of what the old held pose was
  worth.

**Touch is a joystick, not a swipe detector** (`TOUCH — hold and slide`). Wherever
the thumb lands becomes the origin; horizontal offset maps onto position at
`laneUnitPx()` (~86px per lane on a phone, clamped 72–150px). Two details do the
work:
1. **Re-anchoring at the rail** — pushing past the outer lane moves the anchor
   with the thumb, so a reversal answers on the next pixel instead of unwinding
   built-up slack, which reads as the controls sticking.
2. **The vertical reference expires** (`JUMP_WIN = 130ms`). A jump is 30px of
   travel inside that window — a flick. A thumb wandering down the glass over a
   second never adds up to one, so steering and jumping share a finger without
   fighting.

Keyboard became hold-to-steer (`KEY_RATE = 2.6` lanes/s, ~0.78s to cross), and
stands down entirely while a finger is on the glass so the two can't fight over
`lane`.

### Sprite registration
Constants like `RIDER_CX/CY`, `RIDER_TUBE_*`, `PIG_RING_*`, `HURT_REG`, `DIE_REG`,
`MOVE_REG`, `FLIP_REG` were **measured off the PNG alpha channels**, not guessed.
If a sprite file is replaced, these must be re-measured.

Handle choice depends on the motion: √area + centroid for in-plane rotation
(rotation-invariant), tube-based for yaw/squash (**area is not invariant** there).
When the rider PNG was swapped, its area changed 114,178 → 229,297 px, so
`FLIP_REG.s` had to be recomputed.

The line-dance frames were re-exported 2026-08-14: `line-dance_04-05.png` (a
workaround for an empty `_04` export) was deleted and `_04.png` is now the real
frame. `index copy.html` points at the new file; **`index.html` still points at
the deleted one and 404s frame 4.** Frames 10–12 were dropped from the loop at
the user's request, so `DANCE_KEYS` is nine frames (3s a lap at `DANCE_FPS = 3`).

### Rider animation priority (`drawRider`)
`die > hurt > jump(flip) > duck > move(lean)`

### Panels and layout

`.panel` is a centred flex column — but `justify-content:center` **clips an
overflowing column at both ends**, which is how the title screen lost the top of
its headline and the bottom of its last control at the same time. It now uses
`justify-content:flex-start` with `margin-top:auto` on the first child and
`margin-bottom:auto` on the last: centred while there is room, collapsing to
nothing when there isn't, leaving `overflow-y:auto` free to work. `touch-action`
has to be re-enabled per panel because `body` sets `none` for the game.

Panel bottom padding clears the floating mute button (66px + safe area), which
was clipping a control card's corner on short screens.

The title card now carries only: eyebrow, park name, ride name, the dancing
hero, **Drop In**, **How to Play**, and three control cards. The old tagline and
"collect every letter" prompt moved into the How to Play card, which can explain
them properly. Control cards are keycaps built from the same parts as `.btn`, and
carry **both** keyboard and touch wording in the markup, swapped by a `body.touch`
class rather than written in by JS.

`#howPanel` is the one screen that is mostly reading, so it scrolls (`#howScroll`)
and gets a darker wash than the shared panel gradient. Hazard art is pulled from
`ART` rather than hardcoded, so the card cannot show a different cow than the
chute does. It swallows the keyboard while open — the title is only hidden, not
torn down, so every title shortcut is otherwise still live and Space would start
a run behind a panel the player is reading.

### Loading screen

A chute with water flowing down it and Typhoon's tube riding the leading edge.
One custom property (`--p`, 0..1) drives both the fill width and the tube
position so they cannot drift apart, both eased at .35s — a warm cache fires all
54 files in one frame and the bar must glide, not step.

Progress counts **files, not bytes** (an `<img>` gives no progress events), and a
*failed* file still counts, or one 404 strands the bar short of full forever.
`LOAD_FLOOR = 700ms` keeps a fast load from reading as a flash.

### Audio
Two independent load paths, both always set up:
1. `fetch` + `decodeAudioData` → Web Audio buffers (the good path)
2. `<audio>` elements → fallback, used when `fetch` fails (i.e. `file://`)

**Both paths need testing for any audio change.** Bugs have hidden in the element
path specifically.

- `AudioBufferSourceNode` is single-use; music needs a persistent source + GainNode.
- Pause uses `ac.suspend()`/`resume()` to preserve the playhead, not stop/start.
- `elFade(el, to, secs, onDone)` is the single ramp helper for the element path. It
  captures its own interval handle so a finishing ramp can only clear itself.
  **Do not reintroduce a shared fade slot** — see Lessons.
- Music fades are **linear**, deliberately. An exponential ramp to 0.0001 is a
  72 dB drop and plays as a cut, not a fade.

Tracks: `game-start.mp3`, `game-play.mp3`, `game-over.mp3` (~9 MB total; these
used to be ~36 MB of WAV, which is resolved).

**Autoplay is a browser policy, not a switch.** Verified both ways with the real
page: under Chrome's normal policy the title tune never starts, however it is
asked; with `--autoplay-policy=no-user-gesture-required` it starts on its own with
zero interaction. The code is correct — the platform is the constraint. So:

- The title tune plays at **full volume, no fade-in** (a 1.2s rise made it sound
  like something already playing that you walked in on).
- Gesture listeners are `pointerdown`/`touchstart`, not `click`/`touchend`, so on
  a phone it starts as the finger *lands*.
- **The Drop In press is excluded.** It was the user's usual first touch, so the
  title tune started and the click a moment later handed over to the ride
  track — audible as a millisecond blip. Nothing else is excluded.
- **`finishLoading()` turns the loader into a one-tap gate** when audio is still
  blocked: the bar holds at full with "Tap to start", and that tap both dismisses
  the loader and starts the music, so the title screen always has sound. The gate
  only appears when needed — if the context is already running (repeat visit, or
  a permissive browser) loading ends silently on its own as before.

**Backgrounding.** A Web Audio context does not stop when a tab is backgrounded or
the browser goes behind another app. `Sound.suspendAll()`/`resumeAll()` are wired
to `visibilitychange` plus `pagehide`/`pageshow` (which covers iOS navigating away
or the bfcache). They are separate from `hold()`/`unhold()` on purpose: `hold()`
goes through `ctxr()`, so on a page hidden before anyone touched it, it would spin
up an AudioContext purely to suspend it — and on iOS that spends the gesture the
real unlock still needs. Returning is deliberately **not** symmetrical: a run the
player paused stays silent.

Death sequence timing (verified):

| t | ride music | death cry | game-over |
|---|---|---|---|
| 0.0s | 0.380 | full | — |
| 1.6s | 0.127 | full | starts, fading in over 1.3s |
| 2.4s | silent | full | 0.209 |
| 2.9s | — | ended 2.56s | 0.340 |

## Tooling — IMPORTANT

Rebuilt 2026-08-14 in the session scratchpad
(`/private/tmp/claude-501/.../scratchpad/`). **Session-scoped: it will not be
available to you.** The previous handoff recorded the same loss. Recreating it is
high-value before any nontrivial change — this session it caught a strobing lean
pose, a loader that never reached 100%, and proved the steering worked when it was
reported broken.

- **`harness.js`** — boots the whole game headless in a `vm` context with stubbed
  DOM/canvas/Image/Audio/AudioContext, then drives it: synthetic touch events
  through the real listeners, frame stepping, timer pumping. Two traps, both hit
  again this session: top-level `let`/`const` do **not** land on the sandbox
  object, so probes must be appended *inside* the script to close over them; and
  a stub whose properties are a `Proxy` answers `x ||= []` with a truthy stub, so
  arrays used for recording must be real arrays.
- **`shot.js`** — screenshots at real phone viewports over the DevTools protocol,
  with touch emulation on (so the touch copy renders) and an overflow report per
  device. **Do not use `--window-size` for this** — see Lessons.
- **`serve_copy.py`** — binds `0.0.0.0`, serves `index copy.html` at `/`, sends
  no-store, and injects a measuring probe on `?probe=1`.
- **`audiotest.js` / `gatetest.js` / `bgtest.js`** — drive Chrome under both
  autoplay policies to prove what the browser will and won't allow, and exercise
  visibility changes against the real audio context.

## Lessons paid for the hard way

- **Headless Chrome clamps `--window-size` to a 500px minimum.** A "412px"
  screenshot is really a 500px layout scaled into a 412px image, so it renders
  everything ~25% too large and invents overflow that does not exist. An hour
  went into chasing a bug that lived in the screenshot tool. Use
  `Emulation.setDeviceMetricsOverride` over the DevTools protocol; it also gives
  you `deviceScaleFactor` and mobile/touch emulation for free.
- **`vw` measures the window, `width:100%` measures the parent.** `max-width:
  min(94vw, 560px)` on a padded panel let a row grow wider than the box it sat
  in. Inside a padded container the container's own box is the honest constraint.
- **`justify-content:center` clips overflow at both ends.** Auto margins on the
  first and last child centre without clipping.
- **`var()` is not substituted in SVG presentation attributes** (`fill="var(--x)"`
  silently fails). Use a `style` attribute.
- **`dekey()`** was written on the assumption sun/cloud PNGs had opaque black
  backgrounds. They had real alpha. Removed. Measure the asset.
- **Rib "pointiness":** I claimed a 1.69× aspect stretch. Measurement disproved it
  (art matches the true arc within 1–6 px). Real cause was a gold-cap sawtooth.
- **Water streaks across the whole screen:** tail depth reached −1.462, mirroring
  through the vanishing point. Clamped so tails cannot cross `WATER_NEAR = 0.5`.
- **Arch feet outside the rails:** my own error — I set `HW = sin(A_MAX)×1.15` when
  `sin(A_MAX)` *is* the rim x. Correct value `×0.99`.
- **Tunnel vanishing at the mouth** had *five* stacked causes (near-fade, anchor
  cull, premature despawn, no owning depth band, bore built backwards). Don't stop
  at the first plausible cause.
- **Audio fade slot:** one `__fade` handle per element could not hold two ramps.
  A fade-out installed during a fade-in orphaned the fade-in, which kept pushing
  volume *up* — pinning the track at full level and leaking a timer forever. The
  tick rate gave it away (full level in 550 ms on a 700 ms ramp).
- **Cow/snowman layering** went through four attempts (over rail → under rail →
  split at rim → back to whole-over-rail). User's call: **leave it as is.**
- **A phone will serve a cached page for hours.** "The change isn't working" was
  twice a stale cache, not a bug. Send no-store from the dev server and confirm
  the bytes the device receives before debugging the code.

## Open work

Rewritten 2026-08-18. The user set the four priorities in items 1–4; everything
below them was verified against the working tree that day rather than carried
over from the previous list, so line numbers and file states are current.

**Nothing here has been started.**

### 1. Fix the audio bug on mobile — DONE 2026-08-18

**Symptom.** On Android and iPhone the title tune never played. Past the loader
the title screen sat silent; the tune only surfaced as a fraction of a second on
the Drop In press, immediately replaced by the ride track. Desktop was fine.
Last known-good build was `a5ac618` (Aug 13).

**It was not the autoplay policy.** An earlier session concluded phones simply
block autoplay. The user pushed back — it had worked before — and was right.

**Root cause: `titleTune` latched on intent instead of on confirmed playback.**
`4d00c90` moved the unlock from `click`/`touchend` to
`pointerdown`/`touchstart` to cut perceived latency. On mobile those fire
*before* the browser grants user activation, so `resume()` was a no-op, the
BufferSource started into a **suspended** context and played to nobody — and
`titleTune = true` latched regardless, so `startTitleMusic`'s opening guard
turned every later gesture, including the `click` that WOULD have carried the
activation, into a no-op. The blip on Drop In was that same dead source becoming
audible the instant the context finally resumed, a frame before `start()`
swapped in the ride track.

**Reproduced and verified**, not reasoned about: headless Chrome at 412x915 with
`mobile: true`, `--autoplay-policy=document-user-activation-required`, over the
LAN IP (a plain-http origin with no engagement history), driving real
`Input.dispatchTouchEvent` taps.

| after the loader tap | `titleTune` | AudioContext |
|---|---|---|
| before the fix | `true` | **`suspended`** — silent |
| `a5ac618` (Aug 13) | `true` | `running` |
| after the fix | `true` | `running` |

Clearing the latch by hand and re-tapping restored sound, which isolated the
latch as the blocker rather than the policy.

**The fix.** `startTitleMusic` now commits only when the context is genuinely
running: if it is, play and latch; if it is suspended under a gesture, wait on
the `resume()` promise and re-check inside `.then()`. A gesture that did not
carry the activation simply never resolves, and the next one retries. The
`state !== "title"` guard inside the callback stops a late resolution from
starting the title tune mid-run.

The same latch-on-assumption bug existed on the `<audio>` element path, where a
rejected `play()` was swallowed by `pr.catch(() => {})`. `musicPlay` takes an
`onFail` callback now and releases the latch when the element path is refused.

Desktop regression-checked under `no-user-gesture-required`: unchanged.

**Still open on this item:** none of it is committed, and it has not yet been
confirmed on the user's actual phone — headless emulation reproduced the fault
and shows it fixed, but the real device is the only proof that counts.

### 2. Write AGENTS.md — DONE 2026-08-18

[`AGENTS.md`](AGENTS.md) now exists: the short operating brief, meant to be read
every session. **It does not replace this file** — the split settled on is
AGENTS.md for the rules and the traps, this file for the architecture detail and
the open-work queue, with AGENTS.md pointing here for depth.

To keep them from drifting, the standing instructions were **removed from this
file** rather than copied — they live in AGENTS.md alone now. Three other stale
passages were corrected at the same time: the opening section still described
`index copy.html` on `finger-slide-feature` as where the work lived, the
steering section still claimed to describe that file, and "Running it" claimed
`server.py` was loopback-only when it binds `0.0.0.0`.

Every symbol AGENTS.md names was checked against `index.html` before it shipped.

### 3. Optimise mobile loading on slower networks

**PNG compression done 2026-08-18. Referenced sprites: 26.25 MB -> 6.93 MB, a
73.6% cut.** With the user's own music re-encode the same day, the first load is
now **10.1 MB across 63 files, down from 34.3 MB**.

Method, and why it was not a single blanket pass:

- `pngquant --quality=70-98 --speed 1` then `oxipng -o max --strip safe`.
  `--strip` is where the `caBX` (Canva) and `tEXt`/`iTXt` chunks went.
- **Files already in a palette were left to the lossless pass only.** Twelve of
  them (`letters_*`, `coin-a/b`, `cow-tube`, `yeti-tube`) had been quantised
  before; re-quantising only loses more for nothing.
- **The registration sprites were held to a stricter bar than the rest.** Only
  the rider, backflip, move, duck, hurt, die and pig frames feed a measured
  constant. `pig-1`, `pig-4`, `die_01` and `hurt_01` drifted past tolerance
  under lossy, so those four are **lossless — their alpha is bit-identical**.
  The backdrops and `line-dance_*` frames feed nothing measured (plain blits and
  an `<img>` hero), so they took the full lossy pass: `background-western.png`
  3.86 -> 1.07 MB, `slide.png` 2.00 -> 0.44 MB.

Verified, not assumed:

- Every alpha-derived constant re-measured against the new files. Worst area
  drift is 0.0712% (`move-right_01`), which through the `sqrt(area)` handle is
  **0.142 px at the largest size the rider is ever drawn**. Worst centroid drift
  0.0001 of the sprite box. **Nothing in `index.html` needs re-deriving.**
- All 53 decode, dimensions unchanged, all 63 referenced assets resolve.
- Banding checked by eye on the two big lossy backdrops, not just by metric: the
  difference map is fine-grained dither noise on texture and edges, no broad
  banding. The art is detailed illustration rather than gradient, which is why
  a 256-colour palette holds up.
- Title and in-game screenshotted headless at 412x915. 53/53 images load, no
  network failures, rider still seated correctly in the tube.

**Originals backed up to `/Users/Adam.Hood/projects/stampede-png-backup/`** with
a SHA-256 manifest. This matters beyond the usual: `letters_01`-`08` and
`cabana-umbrella.png` were modified-but-uncommitted when the pass ran, so git
alone would have restored a *stale* version of those, not the pre-compression
one. Restore everything with:
`rsync -a --exclude MANIFEST.sha256 /Users/Adam.Hood/projects/stampede-png-backup/ /Users/Adam.Hood/projects/stampede/`
Delete the backup once the compression is accepted and committed.

Still open on this item:

- **The bar counts files, not bytes** — deliberately, since `<img>` gives no
  progress events. On a slow line that makes it lie: most files finish fast and
  it then sits near full through the one big backdrop. Weighting each file by
  its known byte size fixes the feel without needing real progress events.
- **Defer what the title screen does not need.** The loader still blocks on all
  63 files; `game-over.mp3` is not needed until someone dies, nor the win art
  until they win.
- **Music is now the largest single category** at 2.9 MB of the 10.1.
- Test throttled, not on Wi-Fi. Still not done.
- The ~40 MB of unreferenced files in `assets/` were left alone by the user's
  choice — they are source art, and they never reach a player.

### 4. Implement a leaderboard

Today there is no leaderboard and no backend. Bests are per-device: `BEST` in
`localStorage` under `stampede.best.v1`, tracking `dist`, `coins`, `score`,
`letters`, `runs` (`index.html:1621`), feeding the "NEW BEST" markers on the
results panel. The score calculation already exists (commit `8cec61b`), so the
value to submit is in hand.

This is the one item that changes the shape of the project, so the decisions
come before the code:

- **A shared leaderboard needs a server.** That ends "static site on GitHub
  Pages", or bolts a hosted service onto the side of it.
- **Scope:** global all-time, daily/weekly reset, or per-park/kiosk?
- **Identity:** arcade-cabinet initials, or something accounted? Initials dodge
  every privacy question and suit the ride-queue setting.
- **Abuse:** the score is computed in JavaScript in a file anyone can read. Any
  public board will be forged without server-side validation. Decide how much
  that matters up front — on controlled kiosk hardware, possibly not at all.

### 5. Jump / duck windows are too tight

Carried over, re-verified as open. The user's words: "feels too tight and
unfair." Levers: the lift threshold at `index.html:2927` (`airborne = jumpT >= 0
&& lift > 0.28`), the hazard z-band at `:2939` (`e.z > travelled + 0.5 || e.z <
travelled - 1.2`), `JUMP_DUR = 0.62` at `:1837`, and `tuckT`. Candidates: lower
the threshold, widen the durations, narrow the z-band, or add coyote time after
the input. Measure before and after.

### 6. Mobile render cost — still never profiled on a device

Suspected cost centres unchanged: ~120 water streaks, 12 rail polygons
rebuilding gradients every frame, the park aerial rescaled every frame, ribs
drawn from dz 0.85. The cheapest suspected win is still untaken: `DPR` is
`Math.min(2, devicePixelRatio)` at `index.html:1175`, and capping at 1.5 cuts
fill-rate ~44% on a 2× phone. Profile first — that is a guess until measured.

### 7. 80° plunge set-piece — blocked, and should stay blocked

The fixed-pitch camera tops out near 31.7°; at 80° the vanishing point sits
~4,764 px below the horizon. Needs new art (steep rib, crest lip, plunge pose,
runout splash). A 45° version was built and reverted at the user's request.
Agree camera pitch as a standalone change before reopening.

### Housekeeping found while verifying the above

- **~40 MB of unreferenced files in `assets/`** — not loaded by the game, cloned
  by everyone. `country-music.wav` (17 MB), the master sprite sheets the frames
  were cut from, `tunnel-ring copy.png`, superseded backdrops, and the four
  `.wav` originals of sounds now shipped as mp3. Some is source art worth
  keeping — **the user's call, not a cleanup to make unasked.** Worth a decision
  given `.git` is already 242 MB.
- **No `.gitignore`, and junk is tracked:** five `.DS_Store` files and
  `__pycache__/server.cpython-314.pyc`.
- **Three merged branches to delete:** `finger-slide-feature`,
  `win-screen-rework`, `wipeout-rework` — all zero commits ahead of `main`,
  locally and on `origin`.
- **The test tooling keeps getting lost to session scratchpads** — `harness.js`,
  `shot.js`, `serve_copy.py`, three times now. It earns its keep every time: it
  caught a strobing lean pose and a loader that never reached 100%, proved the
  steering worked when it was reported broken, and verified the compressed
  sprites still rendered. `serve_copy.py` is obsolete (`server.py` already binds
  `0.0.0.0` and sends no-store). **Put the rest in the repo under `tools/`.**
  A working CDP screenshot script was written again on 2026-08-18 — it drives
  `Emulation.setDeviceMetricsOverride` at 412x915, calls `start()` to reach the
  in-game screen, and reports failed image loads. It went to the scratchpad
  again, so it is gone again.

**Closed since the last list:** the `line-dance_04-05.png` reference (current
`index.html` points at the real `line-dance_04.png`); the dangling
`Horse Whinny.mp3` (item 1); the stale opening, steering and "Running it"
sections of this document (item 2). All 63 referenced assets resolve.

**Declined / parked by the user:**
- Narrowing `LANE_A` 0.55 → 0.495 (or shrinking the rider 0.48 → 0.378) so riders
  stop overlapping the rail — "leave it as is for now."
- Cow/snowman rail clipping — "leave it as is for now."

## Git state

Branch `music-bug`, level with `main` (0 commits either way), last commit
`c960856`. The `finger-slide-feature` work described earlier in this document
has long since merged. **The user has not asked for a commit. Confirm before
committing.**

Working tree — all of it the in-flight sound swap, item 1:
- `index.html` modified: `SFX.jump`, `SFX.hurt`, `SFX.dead` switched from `.wav`
  to `.mp3`; the `SFX.hit` key removed and `Sound.hit()` made synth-only.
- `Player Jumping.mp3`, `typhoon-hurt.mp3`, `typhoon-dead.mp3` untracked.
- `Horse Whinny.mp3` and `Happy Game Notification.wav` deleted. Neither is
  referenced any more — the `SFX.hit` key is gone, and the `.mp3` beside the
  second is what loads.
- The superseded `.wav` originals (`Player Jumping.wav`, `typhoon-hurt.wav`,
  `typhoon-dead.wav`) were deleted during the same session.
