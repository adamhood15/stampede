#!/usr/bin/env node
// Verifies the fix for the reported bug: on a run's FIRST completion, the
// results card's fRank figure cycled (loading cue) then settled on "—"
// instead of a number, but opening the leaderboard right after showed the
// real rank. Root cause (confirmed before the fix, see git history of this
// file): setRankFigures()/Board.rankOf() made exactly ONE network attempt
// and returned null (rendered as "—") on any failure — timeout, abort,
// non-OK status, thrown exception — with no retry, while the leaderboard's
// own INDEPENDENT /rank lookup got a fresh shot at the network and usually
// succeeded.
//
// Fix: rankOf() now retries once (RANK_RETRY_ATTEMPTS / RANK_RETRY_DELAY_MS
// in index.html) before giving up. This script checks both ends of that:
// a single transient failure should now recover within the SAME lookup
// (scenario A), and a fully dead endpoint should still degrade to "—"
// rather than retry forever (scenario B).
//
// fetch is stubbed in-page so this is deterministic and hits no real API.
//
// node tools/rank-flaky-network-check.js

const { launchChrome, openPage, evaluate, VIEWPORTS } = require("./cdp");

const SERVER = process.env.STAMPEDE_URL || "http://127.0.0.1:8000/index.html";

async function main() {
  const chrome = await launchChrome({});
  try {
    const { session } = await openPage({ port: chrome.port, url: SERVER, viewport: VIEWPORTS.phone412 });
    await new Promise(r => setTimeout(r, 400));

    const result = await evaluate(session, `
      (async () => {
        // ---- Scenario A: one transient failure, then the retry succeeds ----
        let callsA = 0;
        const realFetch = window.fetch.bind(window);
        window.fetch = (url, opts) => {
          const u = String(url);
          if (u.includes("/rank?score=500")) {
            callsA++;
            if (callsA === 1) {
              // First attempt fails, as a transient network blip would.
              return Promise.reject(new TypeError("network error (simulated)"));
            }
            // The retry succeeds.
            return Promise.resolve(new Response(JSON.stringify({ rank: 42 }), { status: 200 }));
          }
          if (u.includes("/submit")) {
            return Promise.resolve(new Response("{}", { status: 200 }));
          }
          return realFetch(url, opts);
        };

        localStorage.setItem("stampede.rider.v1",
          JSON.stringify({ name: "Testy", token: "testtoken", score: 0, at: Date.now() }));

        const el = document.getElementById("fRank");

        pendingScore = 500;
        syncRankRow();                     // results card after the run ends

        await new Promise(r => setTimeout(r, 900));  // let the failed attempt + retry settle

        const scenarioA = {
          callsA,
          resultsCardText: el.textContent,
          resultsCardClass: el.className,
          meScore: Board.me().score,
          meRank: Board.me().rank,
        };

        // ---- Scenario B: every attempt fails — must still degrade to "—",
        // not retry forever ----
        localStorage.setItem("stampede.rider.v1",
          JSON.stringify({ name: "Testy2", token: "testtoken2", score: 0, at: Date.now() }));
        let callsB = 0;
        window.fetch = (url, opts) => {
          const u = String(url);
          if (u.includes("/rank?score=700")) {
            callsB++;
            return Promise.reject(new TypeError("network error (simulated)"));
          }
          if (u.includes("/submit")) {
            return Promise.resolve(new Response("{}", { status: 200 }));
          }
          return realFetch(url, opts);
        };

        pendingScore = 700;
        syncRankRow();
        await new Promise(r => setTimeout(r, 900));

        const scenarioB = {
          callsB,
          resultsCardText: el.textContent,
          resultsCardClass: el.className,
        };

        window.fetch = realFetch;
        return { scenarioA, scenarioB };
      })()
    `, { awaitPromise: true });

    console.log(JSON.stringify(result, null, 2));
    const { scenarioA, scenarioB } = result;

    const ok =
      scenarioA.callsA === 2 &&                       // first attempt + one retry
      scenarioA.resultsCardText === "#42" &&           // retry's rank won, not "—"
      !scenarioA.resultsCardClass.includes("calculating") &&
      scenarioA.meScore === 500 && scenarioA.meRank === 42 &&
      scenarioB.callsB === 2 &&                        // still bounded — no infinite retry
      scenarioB.resultsCardText === "—" &&             // a truly dead endpoint still degrades cleanly
      !scenarioB.resultsCardClass.includes("calculating");

    console.log(ok
      ? "\nPASS: a single transient /rank failure now recovers via retry; a fully dead endpoint still degrades to — after a bounded number of attempts."
      : "\nFAIL — behavior does not match expectations, investigate further.");
    process.exit(ok ? 0 : 1);
  } finally {
    await new Promise((resolve) => {
      chrome.child.once("exit", resolve);
      chrome.child.kill();
    });
    require("node:fs").rmSync(chrome.userDataDir, { recursive: true, force: true, maxRetries: 3 });
  }
}

main().catch(e => { console.error(e); process.exit(1); });
