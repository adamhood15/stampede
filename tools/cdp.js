// Minimal Chrome DevTools Protocol client for headless verification.
//
// Why hand-rolled: no npm dependency, no build step, matches the rest of the
// project. Uses Node's built-in `WebSocket` (Node >=22) — no `ws` package.
//
// Usage: see tools/README.md and tools/screenshot.js for a worked example.
//
// AGENTS.md / HANDOFF.md traps this file exists to avoid re-learning:
//   - Never launch with --window-size. Headless Chrome clamps it to a 500px
//     minimum, so a "412px" screenshot is actually rendered at 500px and
//     scaled down — it reads ~25% too large and invents overflow that is not
//     real. Use Emulation.setDeviceMetricsOverride instead.
//   - Force screens from window globals (state, start(), reset(), gameOver(),
//     showOver(), showReveal(), openBoard()) rather than synthesising clicks.
//     A JS-dispatched PointerEvent does not carry the user-activation bit and
//     cannot reproduce audio-unlock bugs; Input.dispatchTouchEvent does.

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  process.env.CHROME_PATH,
].filter(Boolean);

function findChrome() {
  for (const p of CHROME_CANDIDATES) if (fs.existsSync(p)) return p;
  throw new Error("No Chrome/Chromium binary found. Set CHROME_PATH.");
}

// Known-good phone viewports for this page (AGENTS.md), plus the audit widths
// from HANDOFF item 7. Callers can also pass an arbitrary {width,height,dsf}.
const VIEWPORTS = {
  phone412: { width: 412, height: 915, dsf: 2, mobile: true },   // the user's phone class
  w320:     { width: 320, height: 800, dsf: 2, mobile: true },   // small Android / SE
  w360:     { width: 360, height: 800, dsf: 2, mobile: true },   // most common Android
  w390:     { width: 390, height: 844, dsf: 2, mobile: true },
  w768:     { width: 768, height: 1024, dsf: 2, mobile: false }, // tablet
  desktop:  { width: 1280, height: 800, dsf: 1, mobile: false },
};

async function launchChrome({ port = 9333 } = {}) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "stampede-cdp-"));
  const bin = findChrome();
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    // Lets tests reproduce the real autoplay policy rather than the lenient
    // default headless sometimes applies — see AGENTS.md audio section.
    "--autoplay-policy=document-user-activation-required",
  ];
  const child = spawn(bin, args, { stdio: "ignore" });
  const target = await waitForDevtools(port);
  return { child, port, userDataDir, ...target };
}

async function waitForDevtools(port, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return res.json();
    } catch (e) { lastErr = e; }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error("Chrome DevTools endpoint never came up: " + lastErr);
}

class CDPSession {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map(); // event name -> Set<fn>
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        const set = this.listeners.get(msg.method);
        if (set) for (const fn of set) fn(msg.params);
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method).add(fn);
    return () => this.listeners.get(method).delete(fn);
  }

  once(method) {
    return new Promise((resolve) => {
      const off = this.on(method, (params) => { off(); resolve(params); });
    });
  }
}

async function openPage({ port, url, viewport = VIEWPORTS.phone412 }) {
  const res = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" });
  const target = await res.json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  const session = new CDPSession(ws);
  await session.send("Page.enable");
  await session.send("Runtime.enable");
  await session.send("DOM.enable");
  await session.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.dsf,
    mobile: !!viewport.mobile,
  });
  if (viewport.mobile) {
    await session.send("Emulation.setTouchEmulationEnabled", { enabled: true });
  }
  const loaded = session.once("Page.loadEventFired");
  await session.send("Page.navigate", { url });
  await loaded;
  return { session, targetId: target.id, ws };
}

// Runtime.evaluate wrapper that throws JS-side exceptions as real errors
// instead of silently returning `undefined`.
async function evaluate(session, expression, { awaitPromise = false } = {}) {
  const result = await session.send("Runtime.evaluate", {
    expression, returnByValue: true, awaitPromise,
  });
  if (result.exceptionDetails) {
    throw new Error("Page threw: " + JSON.stringify(result.exceptionDetails.exception));
  }
  return result.result.value;
}

module.exports = { launchChrome, openPage, evaluate, VIEWPORTS, CDPSession };
