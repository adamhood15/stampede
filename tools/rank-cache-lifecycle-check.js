#!/usr/bin/env node
// Traces the full rank lifecycle end-to-end against the REAL production
// functions (syncRankRow, setRankFigures, Board.submit, Board.rankOf,
// openBoard, renderBoard) to determine exactly how the results card could
// show a different rank than the full leaderboard for the same standing
// score, per Adam's report:
//   Run 1 (sets best to 8,680): results card #25, leaderboard confirms #25.
//   Run 2 (scores lower, best stays 8,680): results card #21, but the
//   leaderboard STILL shows the same 8,680 row at #25.
//
// Every fetch call is logged (method + URL) so the exact call sequence and
// cache behavior can be read directly off real code, not inferred.
//
// node tools/rank-cache-lifecycle-check.js

const { launchChrome, openPage, evaluate, VIEWPORTS } = require("./cdp");

const SERVER = process.env.STAMPEDE_URL || "http://127.0.0.1:8000/index.html";

async function main() {
  const chrome = await launchChrome({});
  try {
    const { session } = await openPage({ port: chrome.port, url: SERVER, viewport: VIEWPORTS.phone412 });
    await new Promise(r => setTimeout(r, 400));

    const result = await evaluate(session, `
      (async () => {
        const calls = [];
        const realFetch = window.fetch.bind(window);
        window.fetch = (url, opts) => {
          const u = String(url);
          calls.push((opts && opts.method) || "GET", u);
          if (u.includes("/rank?score=")) {
            // Every /rank call for score=8680 answers 25 — a stable server
            // truth, so any divergence has to come from the client, not a
            // moving target.
            return Promise.resolve(new Response(JSON.stringify({ rank: 25 }), { status: 200 }));
          }
          if (u.includes("/leaderboard")) {
            // 50-row board with this player's own row planted at index 24
            // (list position 25), score 8,680, matching what they saw.
            const rows = [];
            for (let i = 0; i < 50; i++) {
              rows.push(i === 24
                ? { player_name: "Boomin' Kayak", score: 8680 }
                : { player_name: "Filler" + i, score: 20000 - i * 100 });
            }
            return Promise.resolve(new Response(JSON.stringify(rows), { status: 200 }));
          }
          if (u.includes("/submit")) {
            return Promise.resolve(new Response("{}", { status: 200 }));
          }
          return realFetch(url, opts);
        };

        // Starting state: standing best BELOW 8,680, so Run 1 is the run
        // that actually sets the new record — matching "Run 1: Best score:
        // 8,680" in the report.
        localStorage.setItem("stampede.rider.v1", JSON.stringify({
          name: "Boomin' Kayak", token: "testtoken", score: 8000, at: Date.now()
        }));

        const el = document.getElementById("fRank");
        const trace = {};

        // ---- Run 1: new best of 8,680 ----
        pendingScore = 8680;
        syncRankRow();
        await new Promise(r => setTimeout(r, 400));
        trace.run1FRank = el.textContent;
        trace.run1Storage = JSON.parse(localStorage.getItem("stampede.rider.v1"));
        trace.callsAfterRun1 = calls.slice();

        // ---- Open the leaderboard after Run 1 ----
        calls.length = 0;
        await openBoard(true);
        const lbYouAfterRun1 = document.querySelector("#lbYou .lbPos");
        const meRowAfterRun1 = Array.from(document.querySelectorAll("#lbList .lbRow.me .lbPos")).map(e => e.textContent);
        trace.leaderboardAfterRun1 = {
          meRowPositions: meRowAfterRun1,
          youRowPos: lbYouAfterRun1 ? lbYouAfterRun1.textContent : null,
          callsFired: calls.slice(),
        };
        closeBoard();

        // ---- Run 2: scores LOWER, best stays 8,680 ----
        calls.length = 0;
        pendingScore = 7300;
        syncRankRow();
        await new Promise(r => setTimeout(r, 400));
        trace.run2FRank = el.textContent;
        trace.run2Storage = JSON.parse(localStorage.getItem("stampede.rider.v1"));
        trace.callsAfterRun2 = calls.slice();

        // ---- Open the leaderboard after Run 2 ----
        calls.length = 0;
        await openBoard(true);
        const lbYouAfterRun2 = document.querySelector("#lbYou .lbPos");
        const meRowAfterRun2 = Array.from(document.querySelectorAll("#lbList .lbRow.me .lbPos")).map(e => e.textContent);
        trace.leaderboardAfterRun2 = {
          meRowPositions: meRowAfterRun2,
          youRowPos: lbYouAfterRun2 ? lbYouAfterRun2.textContent : null,
          callsFired: calls.slice(),
        };

        window.fetch = realFetch;
        return trace;
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
