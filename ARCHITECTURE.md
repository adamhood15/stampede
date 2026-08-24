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

**Priority (`drawRider`, matching the actual check order in code — an earlier
revision of this doc had jump outranking duck, which was never true on
screen): `die > hurt > Season Pass > duck > eat > jump(flip) > whirlpool spin
> speed boost > move(lean)`. `eat` is the Extra Life pickup's pizza-eating
pose (`eatT`/`EAT_DUR`/`quadIdx`, `EAT_REG`) — plays the instant the pickup is
grabbed on the track, not once the flyer lands (see
[Power-ups](#power-ups)). `speed boost` (`boostT`/`SPEED_REG`/`speedFrame`) is
ranked below the whirlpool spin and eat, and any future *auto-triggered,
interruptible* power-up animation belongs in that same low cluster — it's the
most frequent of the effects (every tunnel plus every Fast Pass grab), so
it's the one that steps aside, same logic as the spin stepping aside for
jump/duck. Season Pass (`seasonPassT`/`SEASONPASS_REG`/`seasonPassFrame`) is
the one exception, ranked just below hurt instead: Adam's spec was for it to
play "throughout the entirety of the power-up," not step aside for a jump or
duck — and since `hitRider()` fully no-ops while it's active, it can never
actually collide with die/hurt in practice, so the ordering only matters as a
statement of intent.

**Sprite registration constants were measured off the PNG alpha channels**,
not guessed — `RIDER_CX/CY`, `RIDER_TUBE_*`, `FLIP_REG`, `MOVE_REG`,
`DUCK_REG`, `HURT_REG`, `DIE_REG`, `EAT_REG`, `SPIN_REG`, `SPEED_REG`,
`SEASONPASS_REG`, `PIG_RING_*`, `PIG_REG`. **If a sprite is replaced or
re-encoded, re-measure them** — `tools/season-pass-measure.js` is the
headless-canvas probe used for `SEASONPASS_REG` specifically (locates the
tube by its orange color within each frame's own alpha bbox, same tw/cx/by
shape as every other tube-registered set); adapt it rather than re-deriving
the approach from scratch for the next animated power-up. `FLIP_REG.s` and `MOVE_REG.tw` are `sqrt(area)` ratios against the
*resting* sprite, so re-exporting `typhoon-rider.png` alone invalidates the
whole set.

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
**Extra Life** (`T.EXTRALIFE`), **Whirlpool** (`T.WHIRLPOOL`), **Season Pass**
(`T.SEASONPASS`) — see the README's power-up table for player-facing
descriptions. That's the full 4-5 (rule 1) — no slots left.

**The speed-boost rider animation** (`SPEED_REG`, `speedFrame`, see
[Rider animation](#rider-animation--sprite-registration)) covers BOTH ways
the boost is granted — a tunnel and the Fast Pass pickup — because both
already set the same `boostT`/`boostSuper` pair, so the animation just reads
`boostT` rather than needing a trigger-specific flag. It climbs
`speed_01`→`speed_04` as the boost kicks in, flickers between `speed_03` and
`speed_04` (the two highest-splash frames) for the middle of `BOOST_DUR`
rather than holding flat on one frame, then ramps back down to `speed_01` as
the boost runs out — all timed off `SPEED_RAMP`, a fixed slice of `BOOST_DUR`,
so it stays proportionate if `BOOST_DUR` ever changes. `speedFrame` is a pure
function of `boostT` (no independent timer), so retriggering the boost
mid-ride (grabbing a second Fast Pass, or a second tunnel, before the first
runs out) resets the whole ramp cleanly along with `boostT` itself.

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

Unlike `extraLife` itself, the eating flourish is NOT deferred to the flyer
landing — `eatT = EAT_DUR` and `Sound.eating()` fire right in the grab branch,
same instant as `flyExtraLife()`. Adam's call: the pickup needs its own
immediate feedback rather than a beat of delay while the flyer is still in
the air. The rider plays a 4-frame pizza-eating pose
(`assets/sprites/typhoon-sprites/extra-life/`, `EAT_REG`) while
`typhoon-eating.mp3` plays, chained directly into `typhoon-slurp.mp3` on its
`onended` (see `Sound.eating()` / `sample()`'s `onEnded` param) rather than
guessed with a timer.

**Souvenir Bottle** fires a one-shot radial burst of coins the instant it's
grabbed (`burstCoins()`, from `flySouvenir()`) into a separate `coinSpill`
array (own physics, own draw pass, drawn before `drawFlyers()`) rather than a
trail following the bottle to the HUD — the coins keep falling and fading
after the bottle's own flyer entry is gone. Reuses the world coin sprites'
alternating-face spin.

**Season Pass** (`T.SEASONPASS`, `assets/sprites/power-ups/season-pass.png`)
is the grand finale — deliberately the biggest power-up in the game (rule 2)
and, per Adam's spec, capped at **one appearance per run**: `spawnPowerup()`
drops it from `POWERUP_TYPES` for good (`seasonPassSpawned`, set the instant
one is actually placed, reset in `reset()`) rather than temporarily like
`extraLife`'s "not while one is held" filter.

Grabbing it does NOT start the mechanical effect immediately — it starts a
**3s frozen reveal** (`seasonPassIntroT`, `SEASONPASS_INTRO_DUR`) first.
`update()` early-returns while `seasonPassIntroT > 0` (right after the
`state === "title"` branch): travelled/speed/spawns/collisions all hold still
— only cosmetic particle decay (the pickup's own `puff()`) keeps running, so
it fades out naturally instead of freezing mid-burst. Gameplay music cuts out
the instant it's grabbed (`Sound.musicStop(0.15)`) and stays silent through
the whole reveal; `Sound.seasonPass()` plays the `season-pass.mp3` stinger
over that silence. Once `seasonPassIntroT` ticks down to 0, the world resumes
and the SAME clock hands off to the real effect: `seasonPassT = SEASONPASS_DUR`
(9s) starts, and `Sound.music("seasonPass", null, 0.3)` fades in
`season-pass-music.mp3` on the shared channel — timed off `SEASONPASS_INTRO_DUR`
directly, not the stinger sample's own `onended`, so the freeze/reveal
animation and the music switch stay in lockstep even if `seasonPass()` falls
back to its synth tones. Total presentation is intro (3s) + effect (9s), not
one flat 10s/12s number.

Every mechanical effect starts together the instant `seasonPassT` takes over:
- **Invincibility.** `hitRider()`'s very first line is
  `if (seasonPassT > 0){ seasonPassBounce(); return; }` — ahead of the
  ordinary `invuln` guard, so it's unconditional and cannot be interrupted by
  a hit the way `boostT` is. `seasonPassBounce()` is the "this isn't hurting
  you" tell Adam asked for: a gold-tinted `puff()` at the rider plus
  `Sound.seasonPassSafe()` (a bright, rising synth chime — deliberately not a
  softer version of `hurt()`'s tones) in place of the usual
  shake/flash/hurt-sound. Every hazard (cow/yeti/wave/pig) already funnels
  through `hitRider()`, so this one guard covers all four for free.
- **+50% top speed.** `update()`'s target-speed formula takes
  `Math.max(boostMult, seasonMult)` rather than stacking the two — Season
  Pass's `SEASONPASS_SPEED_MULT` (1.5) simply wins over a concurrent Fast
  Pass/tunnel boost's `BOOST_SUPER_MULT` (1.25) rather than compounding with
  it. Gets the same accelerated ramp-to-target boost normally reserved for
  `boostT > 0`, and the same "going fast" vignette/rush-line read in
  `speedLines()`/`frame()`'s `rushPhase` update — both now check
  `seasonPassT > 0` alongside `boostT > 0`, since the rider is genuinely
  moving faster and the existing cue is generic, not Fast-Pass-specific.
- **The magnet, widened.** The same pull loop Whirlpool uses now runs when
  *either* `whirlpoolT` or `seasonPassT` is > 0, sharing one loop rather than
  a second copy: whichever is active picks the rate/range
  (`SEASONPASS_PULL`/`RANGE` vs `WHIRLPOOL_PULL`/`RANGE`), and the pullable-
  type check only widens past `T.COIN` to `T.LETTER`/`SOUVENIR`/`EXTRALIFE`/
  `BOOST`/`WHIRLPOOL` when Season Pass specifically is running. Hazards are
  never pullable, invincible or not. Coins still get Whirlpool's cosmetic
  `.swirl` orbit wobble under Season Pass too (that gate now also checks
  `seasonPassT > 0`) — nothing else has an equivalent wobble wired up.
- **The rider animation.** Nine frames
  (`assets/sprites/typhoon-sprites/season-pass/`, `SEASONPASS_REG`,
  tube-registered like duck/hurt/eat — measured via
  `tools/season-pass-measure.js`, a headless-canvas alpha/color probe rather
  than a guess, per the measure-before-coding rule) read `seasonPassIntroT`/
  `seasonPassT` directly via `seasonPassFrame()` (no args, no independent
  timer — same reasoning as the speed-boost frames reading `boostT`): frames
  01-06 (`SEASONPASS_INTRO_FRAMES`) step through across the 3s frozen reveal
  itself, paced by `SEASONPASS_INTRO_FRAME_DUR`, landing on `season-pass_06`
  (index 5) right as the world resumes; the effect then **holds on that same
  frame 6** for the whole middle stretch of `seasonPassT`, per Adam's spec;
  the last `SEASONPASS_OUTRO_DUR` (1.8s) of `seasonPassT` ramps 07→09 as the
  effect winds down, landing on the final frame at the exact instant
  `seasonPassT` reaches 0. Ranked in `drawRider()`'s priority chain right
  below hurt and above duck/eat/jump/spin/boost/lean — deliberately
  outranking everything voluntary, per Adam's "throughout the entirety of the
  power-up" spec, rather than stepping aside for a jump or duck the way the
  rarer auto-triggered cues below it do. Gated on `seasonPassIntroT > 0 ||
  seasonPassT > 0`, so it also covers the frozen reveal, not just the
  resumed effect.
- **The pickup glow.** `seasonPassGlow(x, y, h, scale)` is its own motif for
  rule 5 — a bright white core, a golden halo, and slow concentric gold rings
  expanding outward and fading (the literal "spreads out around it") —
  neither Fast Pass's rotating spokes nor Whirlpool's diving motes/pinwheel
  blur. Only draws the uncollected world pickup now (`scale = 1`) — see the
  screen overlay below for the active cue, which replaced an earlier
  rider-anchored version of this same glow at a larger scale. Pickup also
  gets its own DOM `#flash` flash (white-to-gold radial gradient, longer and
  brighter than a hit's plain orange blink) via `flash()`'s optional
  `color`/`opacity`/`dur` params.
- **The active cue: a full-screen overlay, not a rider halo.** Adam's
  explicit call, after trying a halo anchored to the rider like Whirlpool's:
  `seasonPassScreenOverlay()` washes a translucent white-to-gold radial
  gradient across the WHOLE canvas (`ctx.fillRect(0, 0, W, H)`, drawn in
  fixed screen space after the roll/camera transform is reset, alongside
  `fastPassLabel()`), so the cue reads as the screen itself glowing rather
  than a badge trailing him. Gated on `seasonPassIntroT > 0 || seasonPassT >
  0` — up for the frozen reveal AND the resumed effect, pickup to
  power-down — and fades in over the reveal's first 0.3s, holds fully
  opaque, then fades out over the effect's last 0.3s rather than popping in
  or vanishing mid-frame. This is what rule 7 hangs on for the whole
  presentation now.

**The music** is deliberately sequential, not layered, but timed off the
INTRO CLOCK rather than the stinger sample's own end: `Sound.seasonPass()`
plays the `season-pass.mp3` stinger the instant it's grabbed, into the
silence left by `Sound.musicStop(0.15)` cutting the ride track. Only once
`seasonPassIntroT` (measured against this clip's own ~3.03s length) ticks
down to 0 in `update()` does `Sound.music("seasonPass", null, 0.3)` fade in
`season-pass-music.mp3` on the shared channel — "reveal plays out in silence,
then the music takes over," not "sound plays, then music" back to back off
the sample's `onended`. `seasonPassMusicPlaying` is set the same instant, so
the effect's own expiry code (`seasonPassT` reaching 0) knows Season Pass's
track is actually what's playing before it fades out and hands the channel
back to `"ride"`.

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
