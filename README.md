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
python3 server.py          # pass a port as the first argument to change it
```

It prints two URLs — one for this machine, one for your phone:

```
Serving /path/to/stampede
  this machine   http://127.0.0.1:8000/
  phone / LAN    http://192.168.1.42:8000/
```

## Testing on a phone

The server binds `0.0.0.0` and sends `Cache-Control: no-store`, so it is
reachable from a phone and won't serve a stale build. To use it:

1. Put the phone on the **same Wi-Fi network** as this machine.
2. Run `python3 server.py` and type the `phone / LAN` URL it prints into the
   phone's browser.

If the phone can't reach it:

- **macOS firewall** — System Settings → Network → Firewall. Either turn it off
  for the session, or allow incoming connections for Python.
- **Wrong network** — a phone on cellular, or on a "guest" Wi-Fi SSID, is not on
  the same network even if it looks like the same router. Check the phone is on
  the identical SSID.
- **Client isolation** — some routers (and most public/corporate Wi-Fi) block
  devices from talking to each other. Use a personal hotspot from the phone and
  connect this machine to it, then re-run the server to get the new address.
- **Address changed** — the LAN IP is assigned by DHCP and can change between
  sessions. Re-read the printed URL rather than reusing a bookmark.

To confirm the phone is genuinely getting fresh bytes, check the request appears
in the server's log output when you reload.

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

## Power-Ups

Rare pickups riding down the flume, separate from the coins and letters.
Each has its own artwork, glow/strobe effect, sound, and card on the
in-game How to Play screen.

| Power-up | Benefit | Sound |
|---|---|---|
| **Fast Pass** | Surges you past top speed for a few seconds — the same rush a tunnel gives, just something you have to grab. | The existing "Speed Boost 05" effect |
| **Souvenir Bottle** | Instantly banks 100 Buckaroos, same as if you'd collected them one at a time. The Buckaroos HUD figure flashes yellow to call it out. | Its own sound effect |

## Project structure

```
index.html      All markup, CSS, and game logic (rendering, input, audio, HUD)
server.py       Minimal local HTTP server for development
assets/
  music/        Background and game-over music tracks
  sound-effects/  Jump, collect, hurt/death, and UI sound effects
  sprites/      Rider animation frames (move/jump/duck/hurt/die/spin),
                obstacles (cow, pig, snowman, waves), coins, power-ups,
                and backdrop art
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
