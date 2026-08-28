# AGENTS.md

Operating rules for agents working on **Stampede** (Typhoon Texas — Buckaroo
Run). This file is strict rules only, kept lean — for detail, follow the
links:

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — how the renderer, camera,
  steering, sprites, audio, and power-ups actually work; the tooling setup;
  hard-won lessons.
- **[DATABASE.md](DATABASE.md)** — the leaderboard schema, the WordPress
  plugin, and design decisions behind them.
- **[TODOLIST.md](TODOLIST.md)** — the current open-work queue, blocked
  items, and things the user has explicitly parked.

## How to work

- **Ask rather than assume.** When a request is not explicit, ask a
  follow-up before planning edits — do not fill in the blanks yourself.
- **Measure before coding.** Verify against real assets and real geometry
  before writing anything — the first hypothesis has repeatedly been wrong.
- **Plan before editing anything structural.**
- **Comments explain *why*, never *what*.** No narrating comments.
- **Follow DRY.** Prefer existing patterns over introducing abstractions.
- **Name variables explicitly** — not `t`, name it for what it holds.
- **Check mobile viewports on every UI change** — screenshot at phone sizes
  before saying it works.
- **Confirm before committing.** The user asks for commits; never commit
  unprompted. Branch first if on `main`.
- **Report faithfully** — say what you actually verified, and what you
  skipped.
- Run the narrowest relevant test first.
- Do not inspect generated files unless necessary.
- Avoid reading large logs or directories when targeted search works.

### Compaction

When compacting, preserve: current objective, modified file paths,
architectural decisions, unresolved errors, test results, next intended
action.

## The user's setup

- Tests on a **real phone, Android Chrome**. Never explain a mobile bug with
  WebKit/iOS behaviour without checking it applies.
- Run with `python3 server.py` (binds `0.0.0.0`, sends `Cache-Control:
  no-store`). **Never `file://`** — `fetch` fails there and audio silently
  drops to a second code path.
- **A phone will serve a cached page for hours.** Confirm the device
  received fresh bytes before debugging code — "the change isn't working"
  has been a stale cache more than once.

## Verifying your work

- Drive the real page headless over the DevTools protocol — see
  [ARCHITECTURE.md#tooling](ARCHITECTURE.md#tooling) for the setup and
  scripts. **Never use `--window-size`** (headless clamps to a 500px
  minimum and invents overflow that isn't real).
- **Force screens from window globals** (`state`, `start()`, `reset()`,
  `gameOver()`, etc.), not synthetic clicks.
- **Audio unlock bugs need real input events** — `Input.dispatchTouchEvent`
  over CDP, not a JS-dispatched `PointerEvent`.
- **Rebuild verification tooling before any nontrivial change, and commit it
  under `tools/`** — never leave it in a session scratchpad. It has
  repeatedly caught things review did not.
- **Always kill the headless Chrome instance when done** — on every exit
  path, including errors, not just the happy path. Orphaned instances have
  piled up and pegged the user's CPU before. Kill by the specific port or
  `user-data-dir` you launched, and check `ListAgents`/process start times
  before killing anything matching `stampede-cdp-*` in case another session
  is still using it.
- **Distrust your own tools before you distrust the code.** Calibrate a
  metric against a known-good case before trusting its verdict.

## Touching assets

- **Back up before any destructive asset operation, and check git state
  first.** Modified-but-uncommitted is not recoverable by `git checkout` —
  copy to a directory outside the repo with a checksum manifest.
- **Never apply one blanket policy to all art.** Sprites that feed measured
  registration constants need a stricter bar than plain-blit backdrops.
- **Verify what you actually changed** by hashing against the backup — the
  user edits files mid-session; don't claim a saving that was theirs.
- Re-read state rather than trusting a `git status` from earlier in the
  conversation — audio and art are frequently re-exported by the user
  mid-session.

## Power-ups

Standing checklist — run every new power-up against all ten before building:

1. Total of 4–5 power-ups in the game, no more.
2. Should feel fun/exciting to get.
3. Should not spawn too often — not constant loot.
4. Should not spawn too rarely — not a scavenger hunt.
5. Each needs its own differentiating glow/strobe/animation effect — not the
   same effect recolored.
6. Each provides some benefit to the character.
7. When active, the player must get a clear on-screen visual cue that it's
   active, and which power-up it is — not just "something is boosted."
8. Every power-up gets its own card on the How to Play screen with a brief
   benefit description.
9. Every power-up needs its own unique sound effect on pickup.
10. Document each power-up in the README as it's added.

All 5 of the 4–5 total are now built, `Season Pass` (added 2026-08-24) being
the last — no slots remain; a new power-up idea needs the cap itself
(re)negotiated with the user first. Mechanics of what's built, and the shared
spawn-clock rule behind rule 3, are in
[ARCHITECTURE.md#power-ups](ARCHITECTURE.md#power-ups).

## Don't re-raise

Items the user has explicitly parked or declined, and open/blocked work, are
tracked in [TODOLIST.md](TODOLIST.md) — check there before proposing work on
lane width, cow/snowman rail clipping, the 80° plunge set-piece, or anything
else that reads like it may have already been decided.
