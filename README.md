# Stampede — Typhoon Texas: Buckaroo Run

A single-file HTML5 canvas water-slide runner. Steer down an infinite flume,
dodge obstacles, jump waves, and collect Buckaroos (coins) for as long as you
can survive.

Everything — markup, styling, and game logic — lives in `index.html`
(~2,400 lines). There is no build step and no framework; it's plain Canvas 2D
and vanilla JS.

## Running it

Serve the project over HTTP — don't open `index.html` directly via `file://`,
since audio loading (`fetch` + `decodeAudioData`) silently  falls back to a
degraded path when there's no HTTP origin.

```bash
python3 server.py
```

Then open `http://127.0.0.1:8000/` in a browser.

## Controls

| Input | Action |
|---|---|
| `←` / `→` or `A` / `D` | Steer between lanes |
| `↑` / `W` / `Space` | Jump |
| `↓` / `S` | Duck |
| `Esc` / `P` | Pause |
| Swipe left/right | Steer (touch) |
| Swipe up / tap | Jump (touch) |
| Swipe down | Duck (touch) |

## Project structure

```
index.html      All markup, CSS, and game logic (rendering, input, audio, HUD)
server.py       Minimal local HTTP server for development
assets/
  music/        Background and game-over music tracks
  sound-effects/  Jump, collect, hurt/death, and UI sound effects
  sprites/      Rider animation frames (move/jump/duck/hurt/die/spin),
                obstacles (cow, pig, snowman, waves), coins, and backdrop art
old-version/    Earlier prototype (claude-stampede.html), kept for reference
HANDOFF.md      Engineering notes: architecture, known gotchas, and open work
```

## Architecture notes

For a deep dive into how the renderer, camera, sprite registration, and audio
system work — plus a list of hard-won lessons and open tasks — see
[`HANDOFF.md`](HANDOFF.md). Highlights:

- **Rendering** is a pseudo-3D painter's algorithm on Canvas 2D (no real
  z-buffer): a `project(wx, wy, dz)` function maps world coordinates to screen
  space, and the track itself is generated analytically from sine curves
  rather than baked level data.
- **Audio** has two parallel load paths — Web Audio buffers (primary) and
  `<audio>` elements (fallback for restrictive origins) — both of which need
  testing when audio behavior changes.
- **Sprite registration points** (rider center, tube offsets, hit regions)
  were measured directly off each PNG's alpha channel and must be
  re-measured if a sprite is replaced.

## Deployment

This is a static site — pushing to `main` and enabling GitHub Pages (serving
from the repo root) is enough to host it live.
