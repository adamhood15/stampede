#!/usr/bin/env node
// Verifies the rank diagnostic logging added 2026-08-27: silent by default,
// and when armed via localStorage.setItem("stampede.debug.rank","1") (or
// ?debugRank), traces score submitted / score passed to rankOf() / cache vs
// network / the /rank response / leaderboard position, all prefixed "[rank]".
//
// node tools/rank-debug-log-check.js

const { launchChrome, openPage, evaluate, VIEWPORTS } = require("./cdp");

const SERVER = process.env.STAMPEDE_URL || "http://127.0.0.1:8000/index.html";

async function runOnce({ armDebug }) {
  const chrome = await launchChrome({});
  try {
    const { session } = await openPage({ port: chrome.port, url: SERVER, viewport: VIEWPORTS.phone412 });
    const rankLogs = [];
    session.on("Runtime.consoleAPICalled", (p) => {
      const text = (p.args || []).map(a => a.value !== undefined ? a.value : a.description).join(" ");
      if (text.startsWith("[rank]")) rankLogs.push(text);
    });
    await new Promise(r => setTimeout(r, 400));

    const result = await evaluate(session, `
      (async () => {
        ${armDebug ? 'localStorage.setItem("stampede.debug.rank", "1");' : ''}

        const realFetch = window.fetch.bind(window);
        window.fetch = (url, opts) => {
          const u = String(url);
          if (u.includes("/rank?score=")) {
            return Promise.resolve(new Response(JSON.stringify({ rank: 33 }), { status: 200 }));
          }
          if (u.includes("/leaderboard")) {
            return Promise.resolve(new Response(JSON.stringify([
              { player_name: "Someone Else", score: 99999 },
            ]), { status: 200 }));
          }
          if (u.includes("/submit")) {
            return Promise.resolve(new Response("{}", { status: 200 }));
          }
          return realFetch(url, opts);
        };

        localStorage.setItem("stampede.rider.v1", JSON.stringify({
          name: "Boomin' Kayak", token: "testtoken", score: 8680, at: Date.now()
        }));

        // NOTE: RANK_DEBUG is captured once at page load (a manual toggle,
        // not something that needs to react mid-session), so arming it via
        // localStorage after the page already loaded intentionally has NO
        // effect until reload — this test's "armed" case reloads to pick it
        // up, matching how a real user would use it.
        return true;
      })()
    `, { awaitPromise: true });

    if (armDebug) {
      // Reload so RANK_DEBUG's one-time read at load picks up the flag.
      const loaded = session.once("Page.loadEventFired");
      await session.send("Page.reload", {});
      await loaded;
      await new Promise(r => setTimeout(r, 400));
      await evaluate(session, `
        (() => {
          const realFetch = window.fetch.bind(window);
          window.fetch = (url, opts) => {
            const u = String(url);
            if (u.includes("/rank?score=")) {
              return Promise.resolve(new Response(JSON.stringify({ rank: 33 }), { status: 200 }));
            }
            if (u.includes("/leaderboard")) {
              return Promise.resolve(new Response(JSON.stringify([
                { player_name: "Someone Else", score: 99999 },
              ]), { status: 200 }));
            }
            if (u.includes("/submit")) {
              return Promise.resolve(new Response("{}", { status: 200 }));
            }
            return realFetch(url, opts);
          };
          localStorage.setItem("stampede.rider.v1", JSON.stringify({
            name: "Boomin' Kayak", token: "testtoken", score: 8680, at: Date.now()
          }));
        })()
      `);
    }

    await evaluate(session, `
      (async () => {
        pendingScore = 7300;
        syncRankRow();
        await new Promise(r => setTimeout(r, 400));
        await openBoard(true);
      })()
    `, { awaitPromise: true });

    return rankLogs;
  } finally {
    await new Promise((resolve) => {
      chrome.child.once("exit", resolve);
      chrome.child.kill();
    });
    require("node:fs").rmSync(chrome.userDataDir, { recursive: true, force: true, maxRetries: 3 });
  }
}

async function main() {
  const silentLogs = await runOnce({ armDebug: false });
  const armedLogs = await runOnce({ armDebug: true });

  console.log("Silent-mode [rank] logs:", silentLogs.length);
  console.log("Armed-mode [rank] logs:");
  armedLogs.forEach(l => console.log("  " + l));

  const ok =
    silentLogs.length === 0 &&
    armedLogs.some(l => l.includes("submit() score 7300 does not beat standing best 8680")) &&
    armedLogs.some(l => l.includes("rankOf() cache hit — score 8680 rank 33") || l.includes("rankOf() cache miss for score 8680")) &&
    armedLogs.some(l => l.includes("renderBoard()"));

  console.log(ok ? "\nPASS" : "\nFAIL");
  process.exit(ok ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
