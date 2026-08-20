# Handoff — `index.html`

"Typhoon Texas — Buckaroo Run": a single-file HTML5 canvas water-slide runner.
Everything (markup, CSS, game) is in one file, ~5,340 lines. Assets load from
`assets/` as real files. A companion WordPress plugin,
[`waterpark-leaderboard/`](waterpark-leaderboard/), backs its leaderboard.

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
frame. `index.html` points at the real frame — the 404 earlier versions of this
file warned about was fixed. Frames 10–12 were dropped from the loop at the
user's request, so `DANCE_KEYS` is nine frames (3s a lap at `DANCE_FPS = 3`).

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

For a first-time player, the loader also gates on `namesPromise` (the naming
screen's taken-names fetch, started as early as possible in parallel with the
sprites) before it ever dismisses — added 2026-08-20 so the naming reels are
never shown blank while that fetch catches up. See item 3's "after going
live" bugfix section for the story.

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

**Every one of these lives in the session scratchpad and will be gone before you
read this.** That has now happened four times. Rebuilding is cheap and pays for
itself immediately — the 2026-08-18 set caught a collapsed tab bar, a clipped
score, a HUD collision and a dead audio latch, none of which review would have
found. **Put them in `tools/` and commit them.**

All of them drive real Chrome over the DevTools protocol. The shared skeleton is
about 25 lines: spawn `--headless=new` with `--remote-debugging-port`, GET
`/json/version`, open the returned WebSocket, `Target.createTarget` +
`Target.attachToTarget {flatten:true}`, then `Runtime.evaluate` and
`Page.captureScreenshot` against that session id. `ws` is the only dependency.

- **`shot.js`** — screenshot any screen at a real phone viewport. Reports failed
  image loads and broken `<img>`s.
- **`newflow.js` / `flow.js`** — walk the whole game: first visit, naming,
  title, a run, word completion, wipeout, reveal, results, return visit. Asserts
  panel visibility at each step and collects `Runtime.exceptionThrown`. This is
  the one to rebuild first.
- **`overflow.js`** — pushes typical/big/extreme figures through the HUD and the
  results stats at 320/360/412 and reports any element whose
  `getBoundingClientRect().right` exceeds the viewport or whose `scrollWidth`
  exceeds its `clientWidth`. Built for item 4; **it is the sweep item 7 needs.**
- **`audiorepro.js`** — reproduces the mobile audio path:
  `--autoplay-policy=document-user-activation-required`, mobile emulation, and
  **real `Input.dispatchTouchEvent` taps**. Synthetic JS events do not carry the
  user-activation bit, so they cannot reproduce audio unlock bugs at all.
- **`coinrate.js`** — runs the game with death disabled and samples
  `coins`/`runScore()` over time. This is how the score ceiling was measured
  rather than guessed.
- **`probe.js`** — one-off computed-style and geometry dumps. The cheapest way
  to answer "why is this element the wrong size".

Two habits worth copying from them:

- **Force screens from globals** (`start()`, `gameOver()`, `showOver()`,
  `openBoard()`), not synthetic clicks on buttons — a dispatched `pointerdown`
  does not reliably satisfy the real listener.
- **Exercise the real code path.** An early overflow run wrote `textContent`
  directly and so never called `setFigure()`; it reported failures that were
  purely the harness's fault. A later run claimed a name *after* submitting a
  score, which re-claimed and reset it to zero. Both cost a round of confusion.

`serve_copy.py`, described in earlier versions of this file, is **obsolete** —
`server.py` already binds `0.0.0.0` and sends no-store.

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

- **A flex item's automatic minimum size is switched off by `overflow`.**
  `min-height:auto` / `min-width:auto` normally stop an item shrinking below its
  content — but only while `overflow` is `visible`. `#lbTabs` set
  `overflow:hidden` for its rounded corners, so its min-height became 0 and a
  scrolling column squashed the whole tab bar to its 6px of border with the
  buttons clipped inside. Rule of thumb: **nothing in a scrolling column should
  shrink** — `#lbScroll > *{flex:none}`.
- **`flex:1 1 0` does not include `min-width:0`.** Same family, different axis:
  the results stats row burst past both screen edges because its cells refused
  to shrink below their content. `.ctl` had been fixed years earlier and the
  lesson did not travel.
- **Never cache a measurement taken on a `display:none` element.** Both widths
  read 0, everything "fits", and the wrong answer sticks. `showOver()` writes
  the figures before the panel is shown, which is how the results Score shipped
  visibly clipped. Bail when `clientWidth` is 0 and let a `ResizeObserver` on
  the *container* re-fit; observing the element itself sees its own font-size
  changes and re-enters.
- **A layout collision can be data-dependent.** The Score board only overlapped
  the STAMPEDE letters once the figure was wide enough. A probe with a small
  score passed; the screenshot with 85,460 overlapped. Fill fields with
  worst-case content before believing a layout works.
- **Sizing a container's children with `width:100%` when the container is
  shrink-to-fit is circular.** `#lbList` had no width of its own, so under
  `align-items:center` it hugged its content and its rows came out narrower than
  the sibling that sized itself. Size containers; let block-level children fill.
- **Check small artwork at its real size, not just enlarged.** The first swap
  glyph looked fine at 200px and read as an orange smudge at 44px — the arrows
  were 20 units wide but 6 tall, so the heads collided with their own shafts.
  Render candidates at both sizes side by side before choosing.
- **`translateY` must be repeated in every keyframe** of an animation that also
  positions an element, or the animation drops the offset and the element jumps.

## Open work

Last rewritten 2026-08-20. Items 1–2 and 4 are done and their long
investigation logs have been compressed to what's still worth knowing — the
durable lessons already live in AGENTS.md. Item 3 (the leaderboard) is where
active work is happening and keeps its full detail below.

### 1. Audio bug on mobile — DONE 2026-08-18

Title tune never played on Android/iPhone. Root cause: `titleTune` latched on
gesture *intent* (`pointerdown`/`touchstart`) rather than confirmed playback —
those fire before mobile grants user activation, so the source started into a
suspended context, played to nobody, and the latch then blocked every later
gesture that *would* have worked. Fixed by latching only once
`ac.state === "running"`, waiting on `resume()`'s promise otherwise. Same
latch-on-assumption bug existed on the `<audio>` fallback path (a swallowed
`play()` rejection); fixed the same way. Full repro/verification method is the
durable lesson now in AGENTS.md ("Never latch 'music started' on intent").

Confirmed via headless emulation with real touch-event dispatch; not
separately re-confirmed on the user's own phone since, though extensive real
on-device play since (leaderboard testing) hasn't surfaced a regression.

### 2. Write AGENTS.md — DONE 2026-08-18

[`AGENTS.md`](AGENTS.md) exists: the short operating brief read every session.
Split: AGENTS.md holds the rules/traps, this file holds architecture depth and
the open-work queue.

### 3. Implement a leaderboard

**LIVE as of 2026-08-20.** `Board` calls the `waterpark-leaderboard` plugin's
REST routes instead of `localStorage`. The whole leaderboard implementation
(front end, plugin, `database-plan.md`) is **committed and merged to `main`**
(`0c2841d`, pushed to `origin/main`) — see "Git state" at the bottom of this
file for the full commit/branch picture. Everything below the "Design"
heading further down is the original agreed spec, kept short as background;
the sections above it describe what actually exists in `index.html` and the
plugin now.

#### Status — 2026-08-20

**Committed and merged to `main`, verified against a real WordPress
install.** `waterpark-leaderboard/` (DB layer, repository, name-claim
service, REST controller exposing `/claim`, `/submit`, `/leaderboard`,
`/rank`, `/names`), the 100x100 word pool, and `Board`'s live `fetch()` calls
all landed in one commit. Deployed to the Kinsta dev environment
`env-typhoontexasnew-dev` (WP 7.1, PHP 8.3.25, Wordfence active) over
SSH/WP-CLI and exercised for real, not just `php -l`-linted:
`wp plugin activate` clean, `SHOW CREATE TABLE` matches the plan byte-for-byte
including `utf8mb4_unicode_520_ci` picked up live from
`get_charset_collate()`, all five routes round-tripped with real HTTP
(including the upsert-never-regresses guard and a real `237`-suffix
collision), a deactivate→reactivate cycle preserves rows and schema, and
`/var/log/sitelogs/error.log` stayed empty throughout on the site's real
PHP 8.3.25.

**⚠️ `Board`'s `API` constant is TEMPORARILY an absolute URL, not the
relative path it ships with.** To let the game be tested against the live
Kinsta dev database before it's embedded in WordPress, `index.html`'s
`const API = ...` (search for `env-typhoontexasnew-dev`) points at the dev
site's full `https://.../wp-json/...` URL instead of the same-origin
`/wp-json/waterpark-leaderboard/v1`. WordPress core's REST API reflects
whatever `Origin` header a request carries (verified with curl, both GET and
the POST preflight), which is why this works cross-origin at all — but it
must be **reverted to the relative path** before the game is actually served
from the WordPress site itself, or it will keep talking to the dev
environment from production.

**The Kinsta dev table has accumulated real test data** from this session's
verification and from testing the fixes below against the live board (dozens
of claimed names/scores by now, not just the original two). Fine for a dev
environment; clear it before that environment is used for anything real.

**Fixed this session, on top of the merged commit (uncommitted in
`index.html` as of this writing):**
- The naming screen's reels used to show blank, then fill in, right after the
  loader dismissed — see "Bugs found and fixed — after going live" below.
- The results-card rank stat opening the board used to show it unsorted and
  then visibly animate-scroll to the player's row — same section.
- `#stats{overflow:hidden}` could clip the entire rank row off a real short
  phone viewport when several "New Best" pills landed at once — same
  section. Found from a user bug report, not proactively.
- The "The real drop opens this summer" tagline (`#overTag` /
  `CONFIG.overTag`) was removed outright, not reworded — cut cleanly from the
  DOM, CONFIG, JS wiring, and its CSS animation-stagger rule.

**Not started:**
- Getting `index.html` into an Oxygen Builder code block — asset-path
  rewriting (73 relative `assets/...` references assume same-path hosting),
  and code block vs. plugin-enqueued script. This is also what the temporary
  absolute API URL above is standing in for.
- The full pairwise audit of the 10,000 name combinations — deferred by the
  user, tracked below under "Open for the user".

#### Game flow reworked 2026-08-18

The user restructured the run around the leaderboard. Both halves are **built
and verified**.

**Naming moved to the front.** Loader tap -> `#namePanel` -> title. The tap that
dismisses the loader is the same one that unlocks audio, so the title tune is
already playing when the naming screen appears — nobody is handed a silent
screen and asked to name themselves. Shown **only when there is no stored
rider**; every later visit goes loader -> title untouched (`afterLoader()`).
Copy, revised with the user 2026-08-18: eyebrow **"Howdy Partner,"**, headline
**"What Do They Call Ya?"** — moving "Partner" up to the eyebrow lets the
headline fit on one line at 412px instead of wrapping. Confirm button
**"That'll Do"**.

Layout order, as directed by the user: eyebrow, headline, reels, then the
caption **"Tap to change yer name"** beneath them, then the confirm button.
**There is no Spin button** — each reel is tapped individually.

Each reel carries a **swap badge with a pulsing ray burst**, chosen by the user
from a set of options. It exists because the reels otherwise read as two labels
rather than two controls, and the line of copy saying otherwise is the thing
people skip.

Built as two pseudo-elements on the button — `::before` is the rays, `::after`
the badge — with the word moved into a `.reelWord` span. Details that matter if
this is touched again:

- **`paintReels()` writes into `.reelWord`, never the button.** Setting
  `textContent` on the button would delete the span and take the badge with it.
- **`overflow:hidden` lives on `.reelWord`, not `.reel`.** On the button it
  would clip the badge off at the bottom edge, which is exactly where it sits.
- **Both share `translateY(62%)`**, so they stay concentric and hang mostly
  below the button. At the original 50% the badge sat across the word.
  `.reel` carries 24px of bottom padding for the ~16px it still reaches up.
- **The keyframes repeat the `translateY`.** Omit it and the animation drops the
  offset, and the burst jumps up inside the button.
- **The roll flick is on `.reelWord`, not `.reel`** — animating the button would
  throw the badge and rays around with it.
- Honours `prefers-reduced-motion` by holding the rays static.

Glyph geometry was rendered in isolation and compared at both 200px and true
44px before being chosen; the first attempt read as a smudge at real size
because the arrows were 20 wide but only 6 tall, so the heads collided with
their own shafts.

The consequence worth knowing: with a name guaranteed before the first run,
**submission needs no opt-in and is never prompted** — `syncRankRow()` just
submits. The old `#lbClaim` step inside the leaderboard panel is gone entirely.

**The user chose: the name is set once, with no way to change it later.** Fine
on a personal phone. Worth revisiting if this is ever put on a shared park
kiosk, where the first visitor's name would stick for everyone after.

**The reveal moved to the end of the run.** It used to fire the instant the word
was spelled, freeze the run, and offer Keep Riding. Now the word finishing is
just an animation, the player rides on until the last life is gone, and the
ride-name card is the curtain call:

```
lives 0 -> wipeout -> endRun()
             |-- spelled the word -> showReveal() -> [See Your Score] -> showOver()
             `-- otherwise --------------------------------------------> showOver()
```

`showReveal()` leaves `state` at `"over"` on purpose — `render()` only places
the settled wipeout rider in the dying/over states, so the pose has to keep
drawing behind the card. The results panel is simply held back until asked for.
`revealContinue()` and `revealRestart()` were deleted with their buttons; there
is one way off the card now.

**Open wording question:** the results card still reads "You Survived It" for a
winning run. Every run now ends in a wipeout, so that line is served to someone
who just crashed. It was accurate when the card could be reached mid-run; it is
not any more. Not changed — the user has not been asked.

#### What is built

- **`Board`** — LIVE as of 2026-08-20 (see "Board is live" below). Methods:
  `me()` (local, synchronous — reads the device's own cached rider),
  `claim(adjective, noun)`, `submit(score)`, `top(n)`, `rankOf(score)`,
  `takenNames()` — all five async, all calling `waterpark-leaderboard`'s REST
  routes. `total()` was dropped: nothing ever called it.
- **`#lbPanel`** — the board, built on `#howPanel`'s shape (inner scroller,
  darker wash, swallows the keyboard while open). Single all-time ranking, top
  50, and the player's own row pinned below the list when they fall outside it.
- **Name reels** — `NAME_A` (100 adjectives) x `NAME_B` (100 nouns) = 10,000
  combinations (grown from 40x40 on 2026-08-20 — see "Word lists expanded"
  below). Tap either reel to reroll just that half, or Spin for both. As of
  2026-08-20 rerolls also avoid any pair already claimed (see "Board is live"
  below) — `BAD_NUM`'s digit-suffix blocking moved entirely server-side to
  `class-name-pool.php`, since the client no longer generates suffixes itself.
- **Rank as a stat** — `#statRank`, a row inside the existing `#stats` block on
  the results card. Shows the real rank once claimed, or "you'd rank #N — tap to
  join" before, since `rankOf()` needs only a score.
- **Score in the HUD** — `#hudScore`, in a new `#hudLeft` column under Descent.
- **Leaderboard button** — a second ghost beside How to Play in a `.ghostRow`,
  keeping the title at one primary plus one secondary row.

#### Board is live — 2026-08-20

`Board` now calls `waterpark-leaderboard`'s REST routes (`/claim`, `/submit`,
`/leaderboard`, `/rank`, `/names`) same-origin, instead of `localStorage`.
`me()` stays local and synchronous — it only ever reads the device's own
cached rider, never the network — everything else is async.

**Naming screen, end to end:**
- On open, fetches `/names` (5s timeout) and paints the reels only once that
  resolves, so no name flashes in before being replaced. **Fails open**: if
  the fetch errors or times out, reels paint from an empty taken-set rather
  than blocking the screen — the game must stay playable if the network is
  bad. `#reels.loading` hides the reel text during this brief window.
- Every reroll (single reel or Spin) draws locally against the fetched
  taken-set, bounded at 25 attempts, so the reels should never *offer* an
  already-claimed pair. A genuine race (two players landing on the same
  still-open pair at once) isn't addressed by this — it falls through to
  `claim()`'s own server-side suffix retry, same as it always has.
- Tapping **That'll Do** disables both reels and the button and swaps the
  button label for a CSS spinner (`#nameGo.busy`), then `POST /claim` with an
  8s timeout. Success stores `{token, player_name, score}` (mapped to the
  existing `{name, token, score, at}` shape) and proceeds straight to title,
  unchanged. Failure or timeout re-enables everything and shows *"Couldn't
  save your name — try again in a bit."* (`#nameError`) — the chosen words are
  kept, so retapping retries the same claim rather than rerolling.
- Verified headless: reels populate from an empty taken-set when `/names`
  404s (no backend in local dev), the busy state disables reels + shows the
  spinner immediately on tap, the error path fires and is retryable, and (with
  `fetch` artificially delayed) the spinner renders correctly at 412px.

**Everywhere else**, `submit()` is fire-and-forget — the results card banks
the score locally first and never waits on the network, matching "submission
never needs asking for." `top()`/`rankOf()` are real awaited calls now;
`renderBoard()` and `setRankFigures()` became `async` to match, and
`statRank`'s scroll-to-me now waits on `renderBoard()`'s promise instead of a
fixed two-`requestAnimationFrame` guess, since the row it scrolls to no
longer exists synchronously.

**`python3 server.py` has no `/wp-json` of its own to talk to** — by default,
naming/leaderboard calls from a locally-served game fail there, which is
useful for testing the fail-open paths but not a live claim. Worked around
for now via the temporary absolute `API` URL flagged above, which points a
locally-served game at the real Kinsta dev backend for real end-to-end
testing (a real WordPress install is still needed to exercise it — the
Kinsta dev environment now serves that purpose).

#### Bugs found and fixed while building it

- **The pinned "you" row was wider than the board above it.** `#lbList` had no
  width rule of its own, so as a flex item under `align-items:center` it shrank
  to fit its content — and its rows, sized `width:100%` against a shrink-to-fit
  parent, resolved narrower than `#lbYou`, which sized itself. Fixed by sizing
  the CONTAINERS (`#lbHead`, `#lbList`, `#lbYou` share one width rule) and
  letting the rows, which are block-level grids, simply fill them. Side padding
  on `#lbScroll` also drops from 22px to 9px below 560px so the board runs
  nearly edge to edge on a phone. Verified: rows and the pinned row now match to
  the pixel at both 412px (394px wide, 96% of screen) and 320px (302px, 94%).

- **`#lbTabs` collapsed to 6px**, its buttons clipped inside. A flex item's
  automatic minimum size stops it shrinking below its content **only while
  `overflow` is `visible`** — and the tab bar sets `overflow:hidden` for its
  rounded corners, so `min-height` resolved to 0 and the scrolling column
  squashed it. Fixed with `#lbScroll > *{flex:none}`: nothing in a scrolling
  column should ever shrink.
- **`setFigure()` cached a fit it never made.** Figures are written in
  `showOver()` while `#overPanel` is still `display:none`, so both widths
  measured 0, the text "fitted" trivially, and the cached result shipped the
  results Score visibly clipped. Now `applyFit()` bails when `clientWidth` is 0
  and a **`ResizeObserver` on the CELL** (not the figure — watching the figure
  would see its own font-size changes and re-enter) re-fits when the box becomes
  real. This also covers rotation and desktop resize.
- **The Score board collided with the STAMPEDE letters strip.** `#letters` sat
  at `top:78px`, sized to clear a single row of boards; the left column is two
  tall (128px measured). Moved to 150px. Note the collision only appeared once
  the score had enough digits to widen the board — a probe with a small score
  passed while the screenshot with 85,460 overlapped.
- **Names ellipsised at 320px** ("Speedy Catfi..."). Technically correct — the
  rule is that the *name* gives way and the number never does — but useless to
  read. A `max-width:380px` block gives the name column its space back. Every
  name now fits unellipsised at 320px.

#### Bugs found and fixed — after going live, 2026-08-20

Three more, found from real use once the plugin was live rather than while
building it.

- **Naming-screen reels showed blank, then filled in.** `/names` used to be
  fetched only after the loader dismissed and the naming screen was already
  showing (hidden behind `#reels.loading`'s opacity while it caught up) — the
  fetch and the reveal were sequential. Fixed by starting the fetch
  (`namesPromise`) as soon as `Board` exists, in parallel with the ~10MB of
  sprite loading, and having `ready()` (the loader's finish step) `await` it
  before ever dismissing. `loadTakenNames()` now just reuses that same
  promise instead of firing a second request. Verified against the live dev
  backend over CDP: `/names` resolved ~3s before the naming screen ever
  appeared.
- **Tapping the rank stat showed the board unsorted, then visibly scrolled
  the player's row into place.** `openBoard()` now shows a spinner
  (`#lbLoading`, reusing the existing button-spinner CSS pattern) and jumps
  straight to the player's row — `scrollToMe(true)`, a new instant-jump mode
  alongside the existing eased one — *behind* that spinner, only revealing
  the board once both the fetch and the positioning are done. Verified by
  seeding the live dev board to 20 rows and sampling `scrollTop`: it jumps
  straight to the final value the instant the spinner clears, never animates
  after reveal.
- **`#statRank` (the rank row) could get clipped almost entirely out of
  existence on a real phone.** Same CSS trap as `#lbTabs` above, just found
  later: `#stats{overflow:hidden}` (needed only to clip the "New Best" pill's
  pop-in overshoot) strips `#stats`'s default flex-item protection against
  shrinking below its content. When several pills land at once and the
  results card is taller than the visible viewport, `#stats` — uniquely
  among `#overPanel`'s children — was the thing flexbox squeezed to make it
  fit, and it did that by clipping itself rather than by the panel scrolling.
  Reported by the user on a Samsung S23; reproduced at a realistic 360x650
  viewport (~102px of the rank row clipped) and fixed with `flex-shrink:0` on
  `#stats`. Verified end to end: after the fix the panel correctly becomes
  scrollable instead, and a real click on the rank row after scrolling opens
  the board.

#### Verified

412px and 320px, `Emulation.setDeviceMetricsOverride` at dsf 2, walking title ->
board -> claim -> run -> results. No JS exceptions. The overflow sweep still
passes 18/18.

#### Word list audit — 2026-08-18, RULED ON

All 40 adjectives and 40 nouns read through. The lists are safe from *typed*
profanity by construction; the audit was about tone, association and trademark,
which are judgement calls rather than safety ones.

**RULED ON by the user 2026-08-18: cut `Blazin'` only, keep everything else.**
It was replaced with **`Trusty`** to hold the lists at 40x40 — "trusty steed",
western and wholesome. That replacement is the one word in either list the user
has not personally reviewed.

Everything below is the original audit, kept as the record of what was
considered and consciously accepted — so it is not re-litigated every time
someone new reads the lists.

**Recommended dropping, DECLINED by the user (all kept):**

- **`Bellyflop`** — the clearest one. It is a *body* word bolted onto a person's
  identity, at a venue where everyone is in a swimsuit. "Wobbly Bellyflop",
  "Soggy Bellyflop", "Bouncy Bellyflop" all read as a comment on the player.
- **`Stallion`** — carries a virility read when applied to a person, and
  "Sizzlin' Stallion" is the pairing that makes it obvious.
- **`Sizzlin'`** — the "hot person" sense is the problem, not the word. It is
  what turns several otherwise-fine nouns suggestive.

**Water-hazard names at a water park — considered, kept**

`Riptide`, `Whirlpool`, `Ripcurl`. Rip currents and whirlpools are things that
actually drown people, and parks are normally careful with that imagery. They
are great *words* and completely on-theme; this is a brand-tone call.

**Trademark / strong brand association — considered, kept**

`Longhorn` (UT Athletics — and this is a Texas park, so it reads as
affiliation), `Mustang` and `Bronco` (Ford; Broncos), `Wrangler` (Jeep, jeans),
`Ripcurl` (Rip Curl), `Whirlpool` (appliances), `Gator` (Florida Athletics),
`Frosty` (Wendy's), `Maverick`. None are infringing as a first name on a
leaderboard, but `Longhorn` is the one a Texas park might want to think about.

**Slang the lists may not intend — considered, kept**

- `Blazin'`, `Sunbaked` — cannabis adjacency. `Blazin'` is widely used in family
  food branding, so this is mild.
- `Drippy` — "drip" is a compliment in current slang, but "a drip" is also a
  feeble person, and there is a bodily read.
- `Catfish` — online deception. Mildly ironic on a board of generated names.
- `Stormy` — the Stormy Daniels association.
- `Cowpoke` — legitimate western term, but "cow" is an insult in some English
  dialects and "poke" has its own slang.

**Fine as they are:** every remaining adjective, and `Longhorn`'s neighbours
`Armadillo`, `Rattler`, `Buckaroo`, `Coyote`, `Tumbleweed`, `Roadrunner`,
`Jackrabbit`, `Cactus`, `Sheriff`, `Ranger`, `Drifter`, `Cowpoke`,
`Prairiedog`, `Bluebonnet`, `Cannonball`, `Flume`, `Geyser`, `Gator`,
`Catfish`, `Otter`, `Pelican`, `Dolphin`, `Splashdown`, `Sunfish`, `Seahorse`,
`Bullfrog`, `Turtle`, `Minnow`, `Anchor`, `Torpedo`.

**Bug found during the audit:** `BAD_NUM` listed 13, 69, 86 and 88 — but the
generator draws 100-999, so those could never be produced. They were dead
entries that looked like protection. Now 3-digit only: 187, 322, 420, 451, 666,
911.

#### Word lists expanded — 2026-08-20

Grown from 40x40 to 100x100 (10,000 pairs) at the user's request, to raise the
name-pool ceiling. 60 new adjectives and 60 new nouns were added — western and
water-park themed, matching the existing tone — and mirrored byte-for-byte
into the plugin (`waterpark-leaderboard/includes/class-name-pool.php`), since
the claim endpoint validates against its own copy rather than trusting client
text.

**Not reviewed the way the original 80 words were.** The 2026-08-18 audit above
was the user's own word-by-word read for tone, association, and trademark.
Claude screened the 120 new words for the same categories while writing them,
but that is not the bar the original list was held to. Flagged below.

#### Open for the user

1. **The claim step shows above a full board.** Reads slightly busy — the reels
   and "Use This Name" sit over the top 50. Alternative is a dedicated claim
   view that swaps to the board after.
2. **Stats cells size independently**, so a long Score renders smaller than a
   short Descent beside it (see item 4 below — same root cause, not fixed
   there either).
3. Word lists need a **full read-through before launch** — now 10,000 pairs
   after the 2026-08-20 expansion to 100x100 (was 1,600 at 40x40). That audit
   is the entire safety argument for the closed set, and it has not been done.
   The 60 new adjectives and 60 new nouns added 2026-08-20 additionally have
   not had the word-by-word user review the original 80 got — see "Word lists
   expanded" above.

~~Whether to auto-submit after the first opt-in, or prompt every run~~ —
resolved by the game-flow rework above: naming happens before the first run,
so every submission is automatic and none is ever prompted.

---

#### Design rationale (agreed 2026-08-18, kept short — all of this is now built)

The reasoning behind decisions already implemented above, condensed to what's
still worth knowing if one of them is ever questioned. Full detail was cut
2026-08-20 now that the real, current schema lives in `database-plan.md` and
the real, current code is described earlier in this section.

- **Closed-set naming (reels, never typed text), so nobody reopens it:** free
  text means owning a moderation problem forever, and blocklists lose to
  leetspeak/spacing/homoglyphs/other languages. The real risk isn't a rude
  database row, it's a screenshot of the park's branding beside a slur — a
  closed set makes that structurally impossible rather than policed. This
  argument holds at 100x100 words just as it did at 40x40; only "audit the
  full cross-product in one sitting" stopped being literally true, which is
  why that audit is now its own open item rather than assumed done.
- **A custom WordPress table, not ACF or WS Form.** An ACF repeater
  serialises the whole leaderboard into one `postmeta` row — concurrent
  finishes read-modify-write over each other and lose scores, routine at
  park volume, not rare. ACF-post-per-player avoids that but ranks via a
  `postmeta` value scan and buries wp-admin in junk posts. WS Form is
  append-only where this needs upsert-plus-ranked-reads, and its one real
  edge (admin moderation UI) is moot since the closed-set naming leaves
  nothing to moderate.
- **One panel, three entry points, no HUD entry.** Every existing screen is
  "one primary button + one ghost row"; a third peer button breaks that.
  Rank is a stat on the results card (tapping it opens the board), a second
  ghost button on the title screen, and inline-only after the win reveal.
  Ruled out on the HUD outright — nobody browses a leaderboard mid-run, and
  touch during play is a joystick, so a tap target there is a mis-input
  hazard.
- **Score, not distance or letters, is what's ranked** — and that's why
  Score had to be added to the HUD (item 3's build) once this was decided:
  players were being ranked on a number they never saw mid-run. `runScore()`
  (`index.html:1733`) = coins×10 + letters×250 + spare tubes×500 + speed
  bonus (≤3000). The fixed part caps at 6,500; coins are unbounded, so the
  score itself has no ceiling — see item 4 for why that's fine in practice.
- **Two boards (Daily/All-Time) was tried, then reversed 2026-08-20** back to
  a single all-time ranking — simpler, and there's no `scope` argument
  anywhere in `Board`'s API now.
- **Accepted, not addressed:** anyone can claim any name, and the score is
  computed in client-side JS anyone can read, so it's forgeable. Fine for a
  park promo; revisit only if the board actually gets gamed.

### 4. Long numbers overflow their boxes — FIXED 2026-08-18

Pre-existing, not caused by the leaderboard work. Root cause: `.statRow > div`
and `#coinRow .val` were `flex:1 1 0` with no `min-width:0`, so a long figure
burst the row past the screen edge instead of compressing the cell (`.ctl` had
already been fixed this way; these two were missed). Fixed with `min-width:0`
in both places plus **`setFigure(el, value, maxPx)`**, which formats with
`toLocaleString()` and steps the font size down until it fits (floor 8px),
caching on digit count so it doesn't re-measure every frame. All six HUD/
results figures route through it now. Verified against a measured ceiling
(an unsteered bot's coin rate, generously multiplied), not a guessed one —
everything up to 9 digits fits unshrunk at 320px.

Deliberately not `white-space:nowrap` on `#stats strong` — that would drag
the "New Best" pill up beside the figure, the exact thing `display:block` is
there to prevent, and digits don't need it (a comma carries no line-break
opportunity).

**Open, minor, unchanged since 2026-08-18:** stat cells size independently,
so a long Score can render smaller than a short Descent beside it — degrades
correctly, reads slightly uneven. Tracked once, in item 3's "Open for the
user" list, not duplicated here.

Both things this item once flagged as "still to do once the leaderboard
lands" are done: Score is in the HUD (`#hudScore`), and leaderboard name
columns got their own width fix (see item 3's "Bugs found and fixed").

### 5. Replace Descent with Score in the HUD

Requested by the user 2026-08-18. **Remove the Descent board from the HUD
entirely and move Score into the slot it vacates**, rather than keeping both.

Score currently sits in `#hudLeft` *below* Descent, which is what pushed the
STAMPEDE letters strip from `top:78px` down to `150px` (item 4). Dropping Descent
returns the left column to a single board, so that 150px should very likely go
back to 78px — **re-measure rather than assume**, since the strip only collided
once the figure was wide enough to notice.

Distance stays on the results card (`fDist`), so nothing is lost from the run
summary; it just stops competing for the top of the screen with the number the
leaderboard actually ranks.

### 6. Sky disappearing bug

**Symptom, from the user 2026-08-18:** the **sun, the clouds, and the sky
gradient above the western backdrop disappear when the canvas rotates at extreme
angles.** The park aerial itself stays. Parked deliberately — not being worked
on yet.

Two things already checked, so nobody repeats them:

- **It is NOT the obvious missing-`OVER` bug.** The sky gradient fill already
  overdraws correctly — `ctx.fillRect(-OVER, -OVER, W + OVER*2, horizon + OVER +
  2)` at `index.html:3029` — and `backdrop()` is drawn *inside* the rolled frame
  (`render()`, `index.html:4397`), which is the right place. The first
  hypothesis is dead.
- **The sun and clouds have no vertical overdraw allowance.** Both are placed in
  unrotated screen coordinates inside the `0..horizon` band: the sun at
  `cy = max(d*0.6, horizon*0.32)` (`index.html:3043`), the clouds at
  `cy = horizon * c.v - ch/2` (`index.html:3058`). Clouds get a **horizontal**
  margin of `W*0.35` and a wrap copy, but nothing vertical. Roll pivots about
  the vanishing point at `(W/2, horizon)`, so at `ROLL_MAX = 0.27` rad (~15.5°)
  content near the top of that band swings furthest. **This is the strongest
  lead — start here.**

Worth confirming early whether the gradient genuinely vanishes or is merely
being *covered*, since it and the sun/clouds may be two separate faults that
happen to show together.

### 7. Audit every screen at every viewport

Requested by the user 2026-08-18: **view all screens at a range of widths and
heights and confirm nothing is cut off or pushed out of its box.** Item 4 came
out of doing a slice of this and found a live bug, so the sweep is likely to
find more.

Screens: loading, title, How to Play, in-run HUD, paused, wipeout/results, win
reveal, and the leaderboard panel once it exists.

Widths worth covering: 320 (small Android / SE), 360 (most common Android), 390
and 412 (the user's phone class), 768 (tablet), plus desktop. Heights matter
independently — a short landscape phone is what clipped the title screen top and
bottom once before, which is why "check mobile viewports on every UI change" is
a standing instruction.

Do it with `Emulation.setDeviceMetricsOverride` over CDP, **never
`--window-size`** (headless clamps to a 500px minimum and invents overflow that
is not real — an hour went into that once). The overflow probe written for item
4 already reports `getBoundingClientRect().right > clientWidth` and
`scrollWidth > clientWidth` per element; it belongs in `tools/` rather than a
scratchpad. Fill every field with worst-case content first — longest name,
biggest number, all eight letters lit — since empty states always fit.

### 8. Jump / duck windows are too tight

Carried over, re-verified as open. The user's words: "feels too tight and
unfair." Levers: the lift threshold at `index.html:2927` (`airborne = jumpT >= 0
&& lift > 0.28`), the hazard z-band at `:2939` (`e.z > travelled + 0.5 || e.z <
travelled - 1.2`), `JUMP_DUR = 0.62` at `:1837`, and `tuckT`. Candidates: lower
the threshold, widen the durations, narrow the z-band, or add coyote time after
the input. Measure before and after.

### 9. Mobile render cost — still never profiled on a device

Suspected cost centres unchanged: ~120 water streaks, 12 rail polygons
rebuilding gradients every frame, the park aerial rescaled every frame, ribs
drawn from dz 0.85. The cheapest suspected win is still untaken: `DPR` is
`Math.min(2, devicePixelRatio)` at `index.html:1175`, and capping at 1.5 cuts
fill-rate ~44% on a 2× phone. Profile first — that is a guess until measured.

### 10. Optimise mobile loading on slower networks

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

Originals were backed up outside the repo with a SHA-256 manifest for the
duration of the work and **deleted on 2026-08-18** once it was committed, pushed
and eyeballed. To undo the compression now, revert `c398d6b`.

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

### 11. 80° plunge set-piece — blocked, and should stay blocked

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
- **Six merged branches to delete, all zero commits ahead of `main`:**
  `finger-slide-feature`, `win-screen-rework`, `wipeout-rework`, `music-bug`,
  `leaderboard`, and now `leaderboard-plugin` too (merged 2026-08-20). User
  wants to defer this cleanup ("we'll clean later") — not done yet.
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

**The `origin` remote is still pointed at SSH-over-443** (set 2026-08-18 for
hospital wifi that blocks outbound port 22 — same key, same permissions, only
the transport differs). Unclear whether that network constraint still
applies; the remote hasn't been reverted, and pushes over it are still
working fine as of 2026-08-20.

```
# current
ssh://git@ssh.github.com:443/adamhood15/stampede.git

# revert to this once confirmed off that network
git remote set-url origin git@github.com:adamhood15/stampede.git
```

If a push ever hangs and then fails with `ssh: connect to host github.com port
22: Operation timed out`, that is the network, not the repo — check port 22
with `nc -z github.com 22` before debugging anything else.

**The entire leaderboard implementation is committed and merged.** `main` is
at `0c2841d` (fast-forwarded from `34a35ab`, pushed to `origin/main`) —
`index.html`'s leaderboard/naming/game-flow rework, `database-plan.md`, and
the whole `waterpark-leaderboard/` plugin all landed in one commit, per the
user's choice not to split a day's tightly-coupled work into artificial
pieces.

**Uncommitted right now:** only `index.html`, containing the four fixes from
this session (see item 3's "after going live" section and the tagline
removal) — the loading-screen `/names` race, the leaderboard open-then-scroll
flash, the `#stats` clipping bug, and the removed tagline. **The user asks
for commits — confirm before committing.**

Two things worth knowing before that commit:

- **`Board`'s `API` constant is temporarily an absolute URL** pointed at the
  Kinsta dev site, not the relative path it ships with — see item 3. Must be
  reverted before `index.html` is actually served from WordPress.
- `assets/sprites/chute/tunnel-ring-inner.png` (committed in `7d20a6c`) is
  **still uncompressed (731 KB) and still unreferenced by `index.html`** —
  unchanged since the last time this was flagged. Run it through the item-10
  compression method before it's wired up, and check whether it feeds a
  registration-relevant sprite first.

**Six branches are fully merged into `main` (zero commits ahead) and ready to
delete whenever the user wants to**: `finger-slide-feature`, `win-screen-
rework`, `wipeout-rework`, `music-bug`, `leaderboard`, `leaderboard-plugin`.
Deferred at the user's request ("we'll clean later").

Loose ends, none of them blocking:

- `.git` is ~254 MB. No `.gitignore`; `.DS_Store` files and
  `__pycache__/server.cpython-314.pyc` are tracked.
- The pre-compression PNG/audio backups from item 10 were deleted after that
  work was confirmed — reverting that compression means reverting `c398d6b`,
  not restoring a folder.
