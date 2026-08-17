# Handoff — `index.html`

"Typhoon Texas — Buckaroo Run": a single-file HTML5 canvas water-slide runner.
Everything (markup, CSS, game) is in one file. Assets load from `assets/` as real
files.

| file | lines | what it is |
|---|---|---|
| `index.html` | 3,036 | `main`'s version — three fixed lanes, swipe to steer |
| `index copy.html` | 3,569 | the experiment on `finger-slide-feature`: free slide steering, new loading screen, How to Play card |

**All current work is in `index copy.html`.** It is untracked and has never been
merged. `index.html` is untouched apart from being the thing to diff against.
When the experiment is accepted, it replaces `index.html` wholesale — there is no
partial merge worth doing, the two have diverged across steering, panels, loading
and audio.

## Standing instructions from the user

- **Do not add unnecessary comments.** Comments in this file explain *why* a
  constant has its value or why an approach was rejected — never what the code does.
- **Measure before coding.** Repeatedly in this project my initial hypothesis was
  wrong and measurement overturned it (see "Lessons" below). Verify against the
  real assets/geometry first.
- **Plan before editing** on anything structural. The user interrupted one session
  because I started editing mid-investigation.
- **Follow D.R.Y. Engineering Concept**
- **Follow Explicit variable naming conventions** Instead of naming variables t give the variable an accurate name for what it actually does or contains
- **Ask clarifying questions**: Don't fill in the blanks yourself when the user is not explicit enough, always ask follow up questions before planning your edits.
- **Check mobile viewports on every UI change.** Added 2026-08-14 after a title
  screen shipped that was clipped top and bottom on the user's phone. Screenshot
  it at phone sizes before saying it works — see "Tooling".

## Running it

```
python3 server.py          # serves on 127.0.0.1:8000, loopback only
```
Use the server, not `file://` — `fetch` fails on `file://` and audio silently falls
back to a second code path (see Audio).

For phone testing the server must bind `0.0.0.0`, and the phone must be sent
no-store headers or it will replay a cached build for hours. A session server
doing both (plus serving `index copy.html` at `/`) lived in the scratchpad; see
"Tooling". A cached page cost an hour once — the steering was reported broken
when the phone was simply running the previous build.

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

### Steering — free slide (`index copy.html` only)

The single biggest divergence from `main`. `lane` used to be an integer in
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

**Task 1 — jump / duck windows are too tight.** The user's words: "feels too
tight and unfair." Not started. The levers are in the collision loop: `T.WAVE`
tests `airborne` (`jumpT >= 0 && lift > 0.28`), `T.PIG` tests `ducking`
(`tuckT > 0`), both inside the z-band `e.z > travelled + 0.5 || e.z < travelled -
1.2`. Candidates: lower the 0.28 lift threshold, widen `JUMP_DUR`/`tuckT`, narrow
the hazard z-band, or add coyote time after the input. Measure before and after.

**Task 2 — `index.html` still references the deleted `line-dance_04-05.png`.**
One-line fix, but it is on `main`'s file and outside the current branch's scope.

**Task 3 — 80° plunge set-piece.** Blocked on camera pitch: the fixed-pitch camera
tops out around 31.7°, and at 80° the vanishing point sits ~4,764 px below the
horizon. Best done as a scripted set-piece. Needs new art: a steep-section rib
(near-circular cross-section), a crest/lip piece, a plunge rider pose, a runout
splash. A 45° version was built and then **reverted at the user's request**.
Agree camera pitch with the user as a standalone change before revisiting drops.

**Task 4 — mobile render cost. Still not profiled on device.** Suspected cost
centres: 120 water streaks (~115 strokes/frame), 12 rail polygons rebuilding
gradients every frame, the 1774 px park aerial rescaled every frame, ribs drawn
from dz 0.85. Cheapest suspected win: cap `DPR` at 1.5 (currently `min(2, dpr)`).

**Declined / parked by the user:**
- Narrowing `LANE_A` 0.55 → 0.495 (or shrinking the rider 0.48 → 0.378) so riders
  stop overlapping the rail — "leave it as is for now."
- Cow/snowman rail clipping — "leave it as is for now."

## Git state

Branch `finger-slide-feature`, last commit `a5ac618` ("tweaked speed"). Nothing
from this session has been committed — **the user has not asked for a commit.
Confirm before committing.**

Working tree:
- `index copy.html` — untracked, holds all of the work described above.
- Line-dance PNGs modified, `line-dance_04-05.png` deleted, `line-dance.png`
  (1.7 MB, the full sheet) untracked. These came from the user re-exporting
  sprites, not from code changes.
- `line-dance_10..12.png` are still on disk but no longer loaded by the game.
  The user has not asked for them to be deleted.
