#!/usr/bin/env node
// Investigates the reported bug: standing rank was #25 at a best score of
// 8,680; a run that finished LOWER, at 7,727, ended with fRank showing #21.
// A lower score should never move rank down (better) via this run at all —
// Board.submit() only overwrites the cached best (and only then clears the
// cached rank) when the new score is STRICTLY GREATER than the standing one.
//
// This script isolates the exact question: when a run's score is lower than
// the standing best, what score value does syncRankRow() actually ask the
// server to rank? It stubs fetch to RECORD the queried score (not to fake a
// result) so the real code path decides what to send.
//
// node tools/rank-lower-score-check.js

const { launchChrome, openPage, evaluate, VIEWPORTS } = require("./cdp");

const SERVER = process.env.STAMPEDE_URL || "http://127.0.0.1:8000/index.html";

async function main() {
  const chrome = await launchChrome({});
  try {
    const { session } = await openPage({ port: chrome.port, url: SERVER, viewport: VIEWPORTS.phone412 });
    await new Promise(r => setTimeout(r, 400));

    const result = await evaluate(session, `
      (async () => {
        const rankQueries = [];
        const submitBodies = [];
        const realFetch = window.fetch.bind(window);
        window.fetch = (url, opts) => {
          const u = String(url);
          if (u.includes("/rank?score=")) {
            rankQueries.push(u.split("score=")[1]);
            // Server truth doesn't matter for this check — we're only
            // watching what score the client asks about.
            return Promise.resolve(new Response(JSON.stringify({ rank: 21 }), { status: 200 }));
          }
          if (u.includes("/submit")) {
            submitBodies.push(opts && opts.body);
            return Promise.resolve(new Response("{}", { status: 200 }));
          }
          return realFetch(url, opts);
        };

        // Standing rider, as before this run: best score 8,680, with a
        // rank of 25 already cached against that exact score (matching what
        // the player says they saw previously).
        localStorage.setItem("stampede.rider.v1", JSON.stringify({
          name: "Testy", token: "testtoken", score: 8680, rank: 25, at: Date.now()
        }));

        const el = document.getElementById("fRank");

        // Simulate the run that just finished LOWER than the standing best —
        // exactly what showOver() does at the top of its body (pendingScore
        // = score; syncRankRow();).
        pendingScore = 7727;
        syncRankRow();

        await new Promise(r => setTimeout(r, 500));

        return {
          rankQueries,           // every score value actually queried against /rank
          submitFired: submitBodies.length > 0,
          submitBodies,
          finalFRankText: el.textContent,
          meAfter: Board.me(),
        };
      })()
    `, { awaitPromise: true });

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await new Promise((resolve) => {
      chrome.child.once("exit", resolve);
      chrome.child.kill();
    });
    require("node:fs").rmSync(chrome.userDataDir, { recursive: true, force: true, maxRetries: 3 });
  }
}

main().catch(e => { console.error(e); process.exit(1); });
