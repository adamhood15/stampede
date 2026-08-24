# Architecture — `index.html`

"Typhoon Texas — Buckaroo Run": a single-file HTML5 canvas water-slide runner.
Everything — markup, CSS, game logic, rendering, input, audio, HUD — is in
`index.html` (~6,750 lines). No build step, no framework, plain Canvas 2D and
vanilla JS. A companion WordPress plugin, [`waterpark-leaderboard/`](waterpark-leaderboard/),
backs the leaderboard — see [DATABASE.md](DATABASE.md).

Rules for working on this code live in [AGENTS.md](AGENTS.md). This file is
the detail behind them. Open work is tracked in [TODOLIST.md](TODOLIST.md).

## Where things live

```
index.html      everything: markup, CSS, game logic, rendering, input, audio, HUD
server.py       dev server — binds 0.0.0.0, sends no-store, prints a LAN URL
tools/          committed CDP verification scripts (see Tooling below)
assets/         music, sound-effects, sprites
waterpark-leaderboard/  WordPress plugin backing the leaderboard (see DATABASE.md)
old-version/    earlier prototype, reference only
```

Roughly 39 MB of files under `assets/` are not referenced by the game — master
sprite sheets and superseded art the user keeps as source. Do not clean them
up unasked (see [TODOLIST.md](TODOLIST.md)).

## Running it

```
python3 server.py          # pass a port as the first argument to change it
```

Binds `0.0.0.0` (a loopback bind is invisible to the phone), sends
`Cache-Control: no-store`, and prints both a localhost URL and the LAN URL to
type into the phone. Never use `file://` — `fetch` fails there and audio
silently falls back to the `<audio>`-element path (see Audio below).

## Rendering — Canvas 2D painter's algorithm

Canvas 2D has **no z-index and no depth buffer**. Layering is purely draw-call
order; any "put this behind that" request means reordering draws.

Projection is in `project(wx, wy, dz)`: `s = focal/dz`, `x = W/2 + (wx-camX)*s`,
`y = horizon + (wy-camY)*s`.

Camera roll (`ctx.rotate` about the vanishing point) is driven off the lateral
gradient, `ROLL_K = 0.50` clamped to `ROLL_MAX = 0.27`. Rolling exposes bare
canvas at the corners, so **every full-screen fill must overdraw by `OVER`**
(`= max(W,H) * 0.25`) — a fill of `0,0,W,H` inside the rolled frame produces
visible diagonal seams.

### Draw order inside `chute()`

```
chuteBacking()  ->  ribs / lane guides / water (far to near)
                ->  rimRails()
                ->  tunnels (own pass, must apply farFade() per ring)
                ->  all entities far to near (incl. cow / yeti)
```

`chuteBacking()` exists because gaps between ribs otherwise showed sky.
Tunnels get their own pass and must apply `farFade()` per ring, or they draw
beyond the faded-out chute.

## The track and camera

The track is analytic, not baked: `curveX(z)` and `curveY(z)` are sums of
sines. The track is infinite and stateless — there is no level data.
On-screen turn sharpness is the **gradient**, `≈ sum(amp × freq) × focal` — not
amplitude. "More energetic turns" means raising frequency, not amplitude.

## Steering — continuous lane float

`lane` is a continuous float, not an integer `{-1,0,1}` — everything
downstream multiplies it by `LANE_A`, so geometry, camera bank and rider tilt
needed no change when this became stepless. Obstacles and pickups still
*spawn* on the three whole-numbered lanes; only the rider is free.

- **Collision asks "close enough?"**, not "same lane?" — `LANE_PICK = 0.55`
  (pickups) and `LANE_HIT = 0.40` (obstacles), deliberately unequal: coins
  reach further than the rider so a line can be hoovered, while the gap
  between two obstacles stays genuinely threadable.
- **Collision reads `laneA / LANE_A`** (the eased angle the rider is *drawn*
  at), never `lane` (the input target) — reading the target lets a hit land
  before the sprite visibly arrives.
- **The lean pose is derived from crossing speed**: a *smoothed* velocity
  (`leanV`, eased at `dt*9`) against `LEAN_RATE = 1.1` lane units/s. The raw
  frame-to-frame figure spikes to `delta*13` on any target change, which
  strobes the pose on every thumb trim.
- **Touch is a joystick, not a swipe detector.** Wherever the thumb lands is
  the origin; horizontal offset maps to position at `laneUnitPx()` (~86px per
  lane on a phone, clamped 72–150px). Pushing past the outer lane re-anchors
  with the thumb so a reversal answers on the next pixel. The vertical
  reference expires (`JUMP_WIN = 130ms`) so a jump (30px inside that window)
  and steering can share a finger without fighting.
- Keyboard is hold-to-steer (`KEY_RATE = 2.6` lanes/s) and stands down while a
  finger is on the glass.

**Jump/duck windows:** `airborne = jumpT >= 0 && lift > 0.28` (generous by
design), `JUMP_DUR = 0.62`. If this is ever revisited, the levers are the lift
threshold, the hazard z-band (`e.z > travelled - 3`, wider for tunnels), and
`tuckT`.

## Rider animation & sprite registration

**Priority (`drawRider`):** `die > hurt > jump(flip) > duck > move(lean)`.

**Sprite registration constants were measured off the PNG alpha channels**,
not guessed — `RIDER_CX/CY`, `RIDER_TUBE_*`, `FLIP_REG`, `MOVE_REG`,
`DUCK_REG`, `HURT_REG`, `DIE_REG`, `PIG_RING_*`, `PIG_REG`. **If a sprite is
replaced or re-encoded, re-measure them.** `FLIP_REG.s` and `MOVE_REG.tw` are
`sqrt(area)` ratios against the *resting* sprite, so re-exporting
`typhoon-rider.png` alone invalidates the whole set.

Pick the handle to match the motion: √area + centroid for in-plane rotation
(rotation-invariant), tube-based for yaw/squash (area is **not** invariant
there).

## Panels & layout

`.panel` is a centred flex column. `justify-content:center` **clips an
overflowing column at both ends** — use `justify-content:flex-start` with
`margin-top:auto` on the first child and `margin-bottom:auto` on the last:
centred while there's room, collapsing to nothing when there isn't.
`touch-action` must be re-enabled per panel because `body` sets `none` for the
game.

`#howPanel` scrolls (`#howScroll`) since it's mostly reading, and swallows the
keyboard while open — the title is only hidden, not torn down, so shortcuts
stay live behind it.

## Loading screen

A chute with water flowing down it and the rider's tube riding the leading
edge. One custom property (`--p`, 0..1) drives both fill width and tube
position so they can't drift apart. Progress counts **files, not bytes** (an
`<img>` gives no progress events); a failed file still counts, or one 404
strands the bar short of full forever. `LOAD_FLOOR = 700ms` keeps a fast load
from reading as a flash.

For a first-time player, the loader also gates on `namesPromise` (the naming
screen's taken-names fetch, started as early as possible in parallel with
sprite loading) before it ever dismisses, so the naming reels are never shown
blank.

## Audio

Two independent load paths, both always set up:
1. `fetch` + `decodeAudioData` → Web Audio buffers (primary)
2. `<audio>` elements → fallback, used when `fetch` fails (i.e. `file://`)

**Both paths need testing for any audio change** — bugs have hidden in the
element path specifically.

- `AudioBufferSourceNode` is single-use; music needs a persistent source +
  GainNode.
- Pause uses `ac.suspend()`/`resume()` to preserve the playhead.
- `elFade(el, to, secs, onDone)` is the single ramp helper for the element
  path; it captures its own interval handle so a finishing ramp can only clear
  itself. **Never reintroduce a shared fade slot** (see Lessons).
- Music fades are **linear**, deliberately — an exponential ramp to 0.0001 is
  a 72 dB drop and plays as a cut, not a fade.
- A sustained effect (e.g. Whirlpool, below) uses a genuine loop channel —
  `Sound.loopStart`/`loopStop` — since one-shot `sample()` sources can't
  sustain past the clip's own length.

**Autoplay is a browser policy, not a switch**, verified both ways with the
real page. Consequences in the code:
- The title tune plays at full volume, no fade-in (a fade read as "something
  already playing that you walked in on").
- Gesture listeners are `pointerdown`/`touchstart`, so on a phone it starts as
  the finger *lands*. The Drop In press is excluded (it's the usual first
  touch, and starting the title tune a moment before the ride track hands
  over produced an audible blip).
- `finishLoading()` turns the loader into a one-tap gate when audio is still
  blocked: the bar holds at full with "Tap to start", and that tap both
  dismisses the loader and starts the music.
- **Never latch "music started" on intent — latch on confirmed playback.**
  `pointerdown`/`touchstart` fire *before* mobile browsers grant user
  activation, so `resume()` there can be a no-op while a source plays into a
  suspended context, silently. Wait on the `resume()` promise and re-check
  `ac.state` inside `.then()`. The same trap exists on the `<audio>` path — a
  rejected `play()` is easy to swallow in a bare `.catch(() => {})`.

**Backgrounding:** a Web Audio context does not stop when a tab is
backgrounded. `Sound.suspendAll()`/`resumeAll()` are wired to
`visibilitychange` plus `pagehide`/`pageshow`. Deliberately **not**
symmetrical — a run the player paused stays silent on return.

Death sequence timing (verified):

| t | ride music | death cry | game-over |
|---|---|---|---|
| 0.0s | 0.380 | full | — |
| 1.6s | 0.127 | full | starts, fading in over 1.3s |
| 2.4s | silent | full | 0.209 |
| 2.9s | — | ended 2.56s | 0.340 |

## Power-ups

Rules and the 10-point checklist live in [AGENTS.md](AGENTS.md#power-ups).
**Spawning is one shared clock across every power-up type**
(`spawnPowerup()`, `POWERUP_GAP`, `POWERUP_TYPES`) — a new power-up adds an
entity type to `POWERUP_TYPES`, never a second spawn function, or rule 3
("not too often") quietly breaks as more types are added.

Built: **Fast Pass** (`T.BOOST`), **Souvenir Bottle** (`T.SOUVENIR`),
**Extra Life** (`T.EXTRALIFE`), **Whirlpool** (`T.WHIRLPOOL`) — see the
README's power-up table for player-facing descriptions.

**Whirlpool** grants a 6s magnet (`WHIRLPOOL_DUR`), pulling every live coin
within `WHIRLPOOL_RANGE` (8 world units ahead) toward the rider's own
depth/lane every frame (`update()`'s magnet pass, before the main collision
loop). It does not add a second collection path — easing a coin's `.i`/`.z`
toward the rider is enough that it falls into the ordinary `T.COIN` branch, so
sound/score/removal are identical to a hand grab. A per-coin `.swirl` phase
adds a cosmetic orbit wobble purely in the draw call; collision math never
sees it. A survived hit does **not** cancel `whirlpoolT`; `gameOver()` does,
since the "play" branch that ticks it down never runs again once a run ends.

The active-cue icon is **static**, not rotating — rotation read as "the badge
is spinning," not "things are being pulled in." The vortex motion lives in
`whirlpoolMotes()` (dots spiraling outer-ring-to-centre, drawn in front of the
icon — behind it, the icon's own sparkle art hides most motes). The cue is
drawn **under** the rider at a small fixed lift (`WHIRLPOOL_ACTIVE_LIFT =
0.16`, not tied to `riderLift()`) — a vortex he's riding over, not a badge
trailing him — called before `drawRider()` so his tube sits on top of it.
`floorPt(z, a, lift)`'s `lift` argument is **not safe above ~1** — its
vertical term is `cos(a) * (1 - lift)`, which flips sign past `lift=1` and
sends the point rocketing up-screen.

**Extra Life** adds a bonus tube (`--red-life`) to the LEFT of the normal
tubes via `drawTubes()` (inserted first — `#tubes` is
`justify-content:flex-end`). `spawnPowerup()` filters `T.EXTRALIFE` out of the
draw entirely while one is already held (`extraLife === true`) — narrower
than the general spawn-rate rule, specific to this power-up. `extraLife` only
flips true once the pickup's flight animation lands in the HUD
(`flyExtraLife()`/`updateFlyers()`), not at grab time, so a hit taken mid-flight
is a normal hit. `hitRider()` runs the same shake/flash/speed-penalty/hurt-
pose/`Sound.hurt()` as every other hit whether or not `extraLife` is set — the
only difference is `lives` is never touched and the bonus tube plays its own
explosion keyframe instead of the normal tube dimming.

**Souvenir Bottle** fires a one-shot radial burst of coins the instant it's
grabbed (`burstCoins()`, from `flySouvenir()`) into a separate `coinSpill`
array (own physics, own draw pass, drawn before `drawFlyers()`) rather than a
trail following the bottle to the HUD — the coins keep falling and fading
after the bottle's own flyer entry is gone. Reuses the world coin sprites'
alternating-face spin.

**Season Pass** (`assets/sprites/power-ups/season-pass.png`) has art dropped
in `assets/` but is not referenced anywhere in `index.html` — no mechanic
defined. Do not start on it unprompted (see [AGENTS.md](AGENTS.md#power-ups)).

## Naming screen (leaderboard front end)

Loader tap → `#namePanel` → title, shown only when there is no stored rider
(every later visit goes loader → title). No Spin button — each of the two
reels (`NAME_A` × `NAME_B`) is tapped individually. Details that matter if
this is touched again:

- **`paintReels()` writes into `.reelWord`**, never the button — setting
  `textContent` on the button deletes the span and its swap badge with it.
- **`overflow:hidden` lives on `.reelWord`, not `.reel`** — on the button it
  clips the badge off at the bottom edge.
- Both the badge (`::after`) and rays (`::before`) share `translateY(62%)` to
  stay concentric.
- **Animation keyframes must repeat `translateY`** — omit it and the offset
  drops, jumping the element.
- The roll flick animates `.reelWord`, not `.reel` — animating the button
  throws the badge/rays around with it.

With a name guaranteed before the first run, `syncRankRow()` submits with no
opt-in prompt. The name is set once, with no way to change it later — fine on
a personal phone, worth revisiting for a shared kiosk.

Backend, schema, and the live-deployment status of the leaderboard are in
[DATABASE.md](DATABASE.md).

## Tooling

Committed under `tools/` (do not leave verification scripts in a scratchpad —
that has cost rebuilding the same script four times). All drive real Chrome
over the DevTools protocol: `--headless=new` with `--remote-debugging-port`,
GET `/json/version`, open the WebSocket, `Target.createTarget` +
`Target.attachToTarget {flatten:true}`, then `Runtime.evaluate` /
`Page.captureScreenshot` against that session id. `ws` is the only dependency.

Current scripts: `cdp.js` (shared CDP helper), `screenshot.js`, and
per-power-up checks (`extralife-check.js`, `whirlpool-check.js`). A
general whole-flow walker and a viewport-overflow sweep have existed before
and been lost to scratchpads — rebuild them into `tools/` before the next
nontrivial UI change (see [TODOLIST.md](TODOLIST.md)).

Two habits worth keeping:
- **Force screens from window globals** (`state`, `start()`, `reset()`,
  `gameOver()`, `showOver()`, `showReveal()`, `openBoard()`), not synthetic
  clicks — a dispatched `pointerdown` does not reliably satisfy the real
  listener.
- **Audio-unlock bugs need real input events.** `Input.dispatchTouchEvent`
  over CDP carries the user-activation bit; a JS-dispatched `PointerEvent`
  does not, so it can't reproduce them at all.

412×915 at `deviceScaleFactor: 2` with `mobile: true` is a known-good phone
viewport for this page.

## Lessons learned (gotchas)

- **Headless Chrome clamps `--window-size` to a 500px minimum.** A "412px"
  screenshot is really a 500px layout scaled down, rendering ~25% too large
  and inventing overflow that isn't real. Use
  `Emulation.setDeviceMetricsOverride` instead.
- **`vw` measures the window, `width:100%` measures the parent.** Inside a
  padded container, the container's own box is the honest constraint.
- **`var()` is not substituted in SVG presentation attributes**
  (`fill="var(--x)"` silently fails) — use a `style` attribute.
- **A flex item's automatic minimum size is switched off by `overflow`.**
  `min-height:auto`/`min-width:auto` stop shrinking below content only while
  `overflow` is `visible`. Rule of thumb: **nothing in a scrolling column
  should shrink** — `<container> > *{flex:none}`.
- **`flex:1 1 0` does not include `min-width:0`.** A row of cells will burst
  past screen edges if its cells refuse to shrink below their content.
- **Never cache a measurement taken on a `display:none` element** — both
  widths read 0, everything "fits," and the wrong answer sticks. Bail when
  `clientWidth` is 0 and re-fit via a `ResizeObserver` on the *container* (not
  the element itself, which would see its own font-size changes and re-enter).
- **A layout collision can be data-dependent.** Fill fields with worst-case
  content (longest name, biggest number) before believing a layout works —
  empty/small states always fit.
- **Sizing a container's children with `width:100%` when the container is
  shrink-to-fit is circular.** Size the container; let block-level children
  fill it.
- **One `__fade` handle per audio element cannot hold two ramps.** A fade-out
  installed during a fade-in orphans the fade-in, which keeps pushing volume
  *up* — pinning the track at full and leaking a timer forever.
- **A phone will serve a cached page for hours.** Confirm the request appears
  in the server log before debugging code — "it isn't working" has twice been
  a stale cache.
- **Distrust your own tools before the code.** A screenshot tool invented
  overflow; `afconvert -s 3` silently ignored `-b`, producing byte-identical
  "different bitrates"; an image diff compared RGB under fully transparent
  pixels and reported a catastrophe that wasn't there. Calibrate a metric
  against a known-good case before trusting its verdict.

## Git remote

Current: `git@github.com:adamhood15/stampede.git` (plain SSH, port 22).
Fallback if a network ever blocks outbound port 22:
`ssh://git@ssh.github.com:443/adamhood15/stampede.git`. If a push hangs and
fails with `ssh: connect to host github.com port 22: Operation timed out`,
check `nc -z github.com 22` before debugging anything else.
