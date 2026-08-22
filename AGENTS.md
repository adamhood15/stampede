# AGENTS.md

Operating rules for agents working on **Stampede** (Typhoon Texas — Buckaroo
Run): a single-file HTML5 canvas water-slide runner. Everything — markup, CSS,
game logic, rendering, input, audio, HUD — is in `index.html` (~5,105 lines).
No build step, no framework, plain Canvas 2D and vanilla JS. Assets are real
files under `assets/`.

This file is the short, durable version: how to work here, and the traps that
have actually cost time. **`HANDOFF.md` is the long form** — architecture in
depth, the full lessons list, and the current open-work queue. Read this every
session; reach for HANDOFF when you need the detail behind a rule.

---

## How the user wants you to work

- **Ask rather than assume.** When the request is not explicit, ask a follow-up
  before planning edits. Do not fill in the blanks yourself.
- **Measure before coding.** Repeatedly on this project the first hypothesis was
  wrong and measurement overturned it. Verify against the real assets and real
  geometry before you write anything.
- **Plan before editing** anything structural. A session was interrupted for
  starting edits mid-investigation.
- **Comments explain *why*, never *what*.** Why a constant has its value, why an
  approach was rejected. Do not add narrating comments.
- **Follow DRY.**
- **Name variables explicitly.** Not `t` — name it for what it actually holds.
- **Check mobile viewports on every UI change.** Screenshot at phone sizes
  before saying it works. A title screen once shipped clipped top *and* bottom.
- **Confirm before committing.** The user asks for commits; do not commit
  unprompted. Branch first if on `main`.
- **Report faithfully.** Say what you actually verified, and what you skipped.
- Prefer existing patterns over introducing abstractions.

- Run the narrowest relevant test first.

- Do not inspect generated files unless necessary.

- Avoid reading large logs or directories when targeted search works.

## Compaction

When compacting, preserve:

- current objective

- modified file paths

- architectural decisions

- unresolved errors

- test results

- next intended action

### The user's setup

- Tests on a **real phone, Android Chrome**. Never explain a mobile bug with
  WebKit/iOS behaviour without checking that it applies.
- Run with `python3 server.py` (binds `0.0.0.0`, sends `Cache-Control:
  no-store`). **Never `file://`** — `fetch` fails there and audio silently drops
  to a second code path.
- **A phone will serve a cached page for hours.** "The change isn't working" has
  twice been a stale cache, not a bug. Confirm the device received fresh bytes
  before debugging code.

---

## Architecture: the things that cause bugs when forgotten

**Canvas 2D has no z-index and no depth buffer.** Layering is purely draw-call
order. Any "put this behind that" request means reordering draws.

**The track is analytic, not baked.** `curveX(z)` and `curveY(z)` are sums of
sines; anything needing track geometry calls them. The track is infinite and
stateless — there is no level data. On-screen turn sharpness is the *gradient*
(`≈ sum(amp × freq) × focal`), so "more energetic turns" means raising
frequency, not amplitude.

**The camera rolls, so every full-screen fill must overdraw by `OVER`.** A fill
of `0, 0, W, H` inside the rolled frame is a bug — it exposes bare canvas at the
corners and produces diagonal seams.

**Draw order inside `chute()`** is load-bearing:
`chuteBacking()` → ribs/lane guides/water (far→near) → `rimRails()` → tunnels
(own pass, must apply `farFade()` per ring) → entities far→near.

**Rider animation priority:** `die > hurt > jump(flip) > duck > move(lean)`.

**Sprite registration constants were measured off the PNG alpha channels**, not
guessed — `RIDER_CX/CY`, `RIDER_TUBE_*`, `FLIP_REG`, `MOVE_REG`, `DUCK_REG`,
`HURT_REG`, `DIE_REG`, `PIG_RING_*`, `PIG_REG`. **If a sprite is replaced or
re-encoded, re-measure them.** Note the coupling: `FLIP_REG.s` and
`MOVE_REG.tw` are `sqrt(area)` ratios against the *resting* sprite, so
re-exporting `typhoon-rider.png` alone invalidates the whole set. Pick the
handle to match the motion — √area + centroid for in-plane rotation
(rotation-invariant), tube-based for yaw/squash (**area is not invariant**
there).

**Audio has two independent load paths, both always set up:** Web Audio
(`fetch` + `decodeAudioData`) and `<audio>` elements (fallback). **Test both on
any audio change** — bugs have hidden specifically in the element path. Also:
music fades are **linear** on purpose (an exponential ramp to 0.0001 is a 72 dB
drop and plays as a cut); one fade handle per element, never a shared slot;
pause uses `ac.suspend()`/`resume()` to keep the playhead.

**Never latch "music started" on intent — latch it on confirmed playback.**
`pointerdown`/`touchstart` fire *before* mobile browsers grant user activation,
so `resume()` there is a no-op and a source started then plays into a suspended
context, silently. If a flag is set anyway, the later `click`/`touchend` that
*would* have worked gets skipped by the guard, and the tune is lost for the
whole session. Wait on the `resume()` promise and re-check `ac.state` inside
`.then()`. The same trap exists on the `<audio>` path: a rejected `play()` is
easy to swallow in a bare `.catch(() => {})`. This cost the title tune on both
Android and iOS and was misdiagnosed once as "phones block autoplay".

**Autoplay is a browser policy, not a switch.** If the title tune does not start
until a touch, that is the platform, and `finishLoading()`'s one-tap gate is the
existing answer. Do not "fix" it.

**Panels:** `justify-content: center` clips an overflowing column at *both*
ends. Use `flex-start` with `margin-top:auto` / `margin-bottom:auto`. `touch-
action` must be re-enabled per panel because `body` sets `none` for the game.

---

## Verifying your work

Rebuild the tooling before any nontrivial change — it has repeatedly caught
things review did not, and it keeps being lost to session scratchpads. **Put it
in `tools/`, not a scratchpad.**

Drive the real page headless over the DevTools protocol:

- **Do not use `--window-size`.** Headless Chrome clamps it to a 500px minimum,
  so a "412px" screenshot is a 500px layout scaled down — it renders ~25% too
  large and invents overflow that does not exist. An hour went into chasing a
  bug that lived in the screenshot tool. Use
  `Emulation.setDeviceMetricsOverride`, which also gives you
  `deviceScaleFactor` and touch emulation.
- **Force screens from window globals** rather than synthesising clicks —
  `state` (`"title"`, `"play"`, `"paused"`, `"dying"`, `"over"`), `start()`,
  `reset()`, `gameOver()`, `showOver()`, `showReveal()`, `openBoard()`.
  Synthetic `pointerdown` on `#playBtn` does not reliably satisfy the real
  listener; calling `start()` does.
- **Audio unlock bugs need REAL input events.** `Input.dispatchTouchEvent` over
  CDP carries the user-activation bit; a JS-dispatched `PointerEvent` does not,
  so it cannot reproduce them at all.
- 412×915 at `deviceScaleFactor: 2` with `mobile: true` is a known-good phone
  viewport for this page — it renders the touch copy and reaches the title and
  in-game screens cleanly.

**Distrust your own tools before you distrust the code.** Real examples from
this project: a screenshot tool that invented overflow; `afconvert -s 3`
silently ignoring `-b` so five "different bitrates" produced byte-identical
files; an image diff that compared RGB under fully transparent pixels and
reported a catastrophe that was not there. **Calibrate a metric against a known
-good case before trusting its verdict.**

---

## Touching assets

- **Back up before any destructive asset operation, and check git state first.**
  Tracked-and-committed is recoverable; modified-but-uncommitted is *not* —
  `git checkout` restores a stale version, silently discarding the user's recent
  re-export. Copy to a directory outside the repo with a checksum manifest.
- **Never apply one blanket policy to all art.** Sprites that feed measured
  constants need a stricter bar than backdrops that are plain blits. Separate
  them, then verify the strict set numerically.
- **Verify what you actually changed** by hashing against the backup. The user
  edits files while you work — do not claim a saving that was theirs.
- Audio and art are frequently re-exported by the user mid-session. Re-read
  state rather than trusting a `git status` from earlier in the conversation.

---

## Facts worth knowing before proposing work

- **First load is ~10.1 MB across 63 files** (sprites ~6.9 MB, music ~2.9 MB).
  The loader blocks on all of them and counts **files, not bytes** — deliberate,
  since `<img>` gives no progress events.
- **Scores are per-device only:** `BEST` in `localStorage` under
  `stampede.best.v1`. There is no backend, and the project deploys as a static
  site.
- **Steering is a continuous float**, not three discrete lanes. Collision asks
  "close enough?" (`LANE_PICK = 0.55`, `LANE_HIT = 0.40`) against `laneA /
  LANE_A` — the eased angle the rider is *drawn* at, never the input target.
  Touch is a **joystick, not a swipe detector**.
- **Parked by the user — do not re-raise unprompted:** narrowing `LANE_A` so
  riders stop overlapping the rail, and the cow/snowman rail clipping. Both are
  "leave it as is for now."
- The 80° plunge set-piece is **blocked** on agreeing camera pitch as a
  standalone change. A 45° version was built and reverted at the user's request.

---

## Power-ups

Standing checklist for every power-up added to the game (set 2026-08-21).
Run new ones against all ten before building:

1. Total of 4-5 power-ups in the game, no more.
2. Should feel fun/exciting to get.
3. Should not spawn too often — not constant loot.
4. Should not spawn too rarely — not a scavenger hunt.
5. Each needs its own differentiating glow/strobe/animation effect, visually
   distinct from the others — not the same effect recolored.
6. Each provides some benefit to the character.
7. When active, the player must get a clear on-screen visual cue that it's
   active — and which power-up it is, not just "something is boosted."
8. Every power-up gets its own card on the How to Play screen with a brief
   benefit description.
9. Every power-up needs its own unique sound effect on pickup.
10. Document each power-up in the README as it's added.

**Spawning is one shared clock across every power-up type** (`spawnPowerup()`,
`POWERUP_GAP`, `POWERUP_TYPES`), not one clock per type — independent clocks
per type would make rule 3 quietly break every time a new power-up is added,
since several independent "occasional" clocks combine into "often." Add a new
power-up's entity type to `POWERUP_TYPES` rather than writing a second spawn
function.

Built so far: **Fast Pass** (`T.BOOST`), **Souvenir Bottle** (`T.SOUVENIR`),
and **Extra Life** (`T.EXTRALIFE`, added 2026-08-21). **Fast Pass** reusing
the existing `Sound.boost()` sample was a one-off exception to rule 9,
requested explicitly — it does not waive rule 9 for future power-ups.
**Season Pass** (`assets/sprites/power-ups/season-pass.png`) has art already
dropped in `assets/` but no mechanic defined or discussed — do not start on
it unprompted.

**Extra Life** adds a bonus tube, visually distinct (`--red-life`, measured
off the art) from the normal orange tubes, placed to their LEFT by
`drawTubes()` (inserted first — `#tubes` is `justify-content:flex-end`, so
DOM order still reads left-to-right within the packed row). It does not go
through the shared `POWERUP_TYPES` draw unconditionally: `spawnPowerup()`
filters `T.EXTRALIFE` out of the draw entirely while one is already held
(`extraLife === true`), per the user's call that a second should never even
appear until the first is used — narrower than rule 3's general spawn-rate
guidance, and specific to this power-up. `extraLife` only flips true once the
pickup's flight animation actually lands in the HUD
(`flyExtraLife()`/`updateFlyers()`), not at the moment it's grabbed — mirrors
how a letter's `shownLetters` lags `gotLetters`, and for the same reason: a
hit taken mid-flight must be a normal hit, not a shield the player never
actually saw granted.

`hitRider()` runs the same shake/flash/speed-penalty/hurt-pose/`Sound.hurt()`
as every other hit whether or not `extraLife` is set — the user's call, after
an earlier "softer" version (no shake, no speed loss, its own sound) read as
inconsistent rather than distinct. The one thing that differs when `extraLife`
is true: `lives` is never touched, and the bonus tube plays its own explosion
keyframe (`explodeExtraTube()`, CSS `.tube.extra.exploding`) instead of the
normal tube being dimmed — `drawTubes()` always rebuilds from scratch, which
would otherwise cut the animation off before it plays, so the real DOM removal
is deferred to the animation's `animationend`. The next hit after that falls
through to the normal `lives--` path unchanged.

**Souvenir Bottle** fires a one-shot radial burst of coins the instant it's
grabbed (`burstCoins()`, called from `flySouvenir()`) rather than a trail that
follows the bottle up to the HUD — the user's call, after an initial trailing
version read as "coins chasing the cup" instead of "coins exploding out of
it." The burst is pushed into a separate `coinSpill` array (own physics, own
draw pass) rather than folding into `flyers` itself, because the coins keep
falling and fading for a beat after the bottle lands and its own flyer entry
is gone. Drawn in the same unrolled screen space as `drawFlyers()`, and before
it, so the bottle sits on top of the coins it just exploded out of. Reuses the
world coin sprites' (`IMG.coinA`/`IMG.coinB`) alternating-face spin rather than
new art, so a burst Buckaroo reads as the same coin, just airborne.

## Where things live

```
index.html      everything: markup, CSS, game logic, rendering, input, audio, HUD
server.py       dev server — binds 0.0.0.0, sends no-store, prints a LAN URL
assets/         music, sound-effects, sprites (see HANDOFF for the layout)
HANDOFF.md      long-form architecture, full lessons list, open-work queue
old-version/    earlier prototype, reference only
```

Roughly 40 MB of files under `assets/` are not referenced by the game — master
sprite sheets and superseded art the user keeps as source. **Do not clean them
up unasked.**
