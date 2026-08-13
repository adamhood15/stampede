# Handoff — `stampede-2.html`

"Typhoon Texas — Buckaroo Run": a single-file HTML5 canvas water-slide runner.
Everything (markup, CSS, game) is in `stampede-2.html` — ~2,400 lines, ~113 KB.
Assets load from `assets/` as real files.

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


## Running it

```
python3 server.py          # serves on 127.0.0.1:8000
```
Use the server, not `file://` — `fetch` fails on `file://` and audio silently falls
back to a second code path (see Audio).

## Architecture

### Rendering: painter's algorithm only
Canvas 2D has **no z-index and no depth buffer**. Layering is purely draw-call
order. Any "z-index" request means reordering draws. The user has been told this.

Projection is in `project(wx, wy, dz)`: `s = focal/dz`, `x = W/2 + (wx-camX)*s`,
`y = horizon + (wy-camY)*s`.

The track is analytic, not baked: `curveX(z)` and `curveY(z)` (lines ~428–434) are
sums of sines. Anything needing track geometry calls these. Two consequences:
- On-screen turn sharpness is the **gradient**, `≈ sum(amp × freq) × focal` — not
  amplitude. "More energetic turns" means raising frequency, not amplitude.
- The track is infinite and stateless; there is no level data.

Camera roll (`ctx.rotate` about the vanishing point) is driven off the lateral
gradient, `ROLL_K = 0.50` clamped to `ROLL_MAX = 0.27`. Because rolling exposes
bare canvas at the corners, every full-screen fill must overdraw by `OVER`
(`= max(W,H) * 0.25`). **A fill of `0,0,W,H` inside the rolled frame is a bug** —
that caused visible diagonal seams once already.

### Draw order inside `chute()` (line ~1457)
```
chuteBacking()  ->  ribs / lane guides / water (far to near)
                ->  rimRails()
                ->  tunnels (own pass)
                ->  all entities far to near (incl. cow / yeti)
```
`chuteBacking()` exists because gaps between ribs otherwise showed sky.
Tunnels get their own pass and must apply `farFade()` per ring, or they draw
beyond the faded-out chute (that was a regression).

### Sprite registration
Constants like `RIDER_CX/CY`, `RIDER_TUBE_*`, `PIG_RING_*`, `HURT_REG`, `DIE_REG`,
`MOVE_REG`, `FLIP_REG` were **measured off the PNG alpha channels**, not guessed.
If a sprite file is replaced, these must be re-measured.

Handle choice depends on the motion: √area + centroid for in-plane rotation
(rotation-invariant), tube-based for yaw/squash (**area is not invariant** there).
When the rider PNG was swapped, its area changed 114,178 → 229,297 px, so
`FLIP_REG.s` had to be recomputed.

### Rider animation priority (`drawRider`, line ~2146)
`die > hurt > jump(flip) > duck > move(lean)`

### Audio (line ~470–680)
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

Tracks: `MUSIC = { ride: country-music.wav, over: game-over.wav }`.

Death sequence timing (verified):

| t | ride music | death cry | game-over |
|---|---|---|---|
| 0.0s | 0.380 | full | — |
| 1.6s | 0.127 | full | starts, fading in over 1.3s |
| 2.4s | silent | full | 0.209 |
| 2.9s | — | ended 2.56s | 0.340 |

## Test harness — IMPORTANT

There is a Node harness that boots the game headless (stubbed DOM, canvas Proxy,
`AudioContext`, `Image`, `Audio`, `fetch`), runs 900 frames, and asserts no runtime
errors and that all `drawImage` args are finite. It has ~40 named probes
(`__turnStats`, `__tunnelRun`, `__musicTest`, `__drawOrder`, `__hurtVsDead`,
`__overSlot`, …). A second variant simulates a `file://` origin to exercise the
`<audio>` path.

**These files were in my session scratchpad, which is session-scoped and will not
be available to you.** I offered to copy them into `tools/` and the user declined,
so they are effectively gone. Recreating one is high-value before any nontrivial
change — it caught a TDZ crash, a swallowed constant block, non-finite draw args,
and the audio bugs described below.

Two traps to avoid if you rebuild it:
- An `uncaughtException` handler that pushes to an array **without printing** makes
  a dead harness look like a passing one. Print and set a non-zero exit code.
- Stub gaps produce false passes. One stale variant died at `start()` and emitted
  two lines that read as success, so it had only ever been testing boot.

Offline, I also used a pure-Python PNG decoder + renderers to inspect visuals
without a browser (measuring rib arcs, rail 3-D shading, the horizon seam). Also gone.

## Lessons paid for the hard way

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

## Open work

**Task 1 — 80° plunge set-piece.** Blocked on camera pitch: the fixed-pitch camera
tops out around 31.7°, and at 80° the vanishing point sits ~4,764 px below the
horizon. Best done as a scripted set-piece. Needs new art: a steep-section rib
(near-circular cross-section), a crest/lip piece, a plunge rider pose, a runout
splash. A 45° version was built and then **reverted at the user's request** —
`before-pitch.html` held that state but was in the lost scratchpad. Agree camera
pitch with the user as a standalone change before revisiting drops.

**Task 2 — mobile render cost.** **Not profiled on device.** Suspected cost
centres: 120 water streaks (~115 strokes/frame), 12 rail polygons rebuilding
gradients every frame, the 1774 px park aerial rescaled every frame, ribs drawn
from dz 0.85. Cheapest suspe
cted win: cap `DPR` at 1.5 (currently `min(2, dpr)`).

**Asset weight (real problem).** `country-music.wav` is 17.5 MB and
`game-over.wav` is 19.1 MB — **~36 MB of uncompressed WAV fetched up front**, far
and away the dominant load cost on a phone. As ~160 kbps MP3s they'd be roughly
2 MB each. Code needs no change beyond the filenames in `MUSIC`. Raised twice; not
yet actioned.

**Declined / parked by the user:**
- Narrowing `LANE_A` 0.55 → 0.495 (or shrinking the rider 0.48 → 0.378) so riders
  stop overlapping the rail — "leave it as is for now."
- Cow/snowman rail clipping — "leave it as is for now."

## Git state

Branch `main`, last commit `5c2c0ff`. The working tree has **substantial
uncommitted work**: `stampede-2.html` modified, the old `typhoon-sprites/back-*`,
`front-*`, `side-*` directional sprites and `background-2.png` deleted, and many
untracked additions (`assets/music/`, `assets/sound-effects/`, `assets/sprites/chute/`,
the `die/ duck/ hurt/ jump/ move/` sprite folders, `park-aerial-2.png`, extracted
sprites). Nothing has been committed this whole effort — the user has not asked for
a commit. Confirm before committing.
