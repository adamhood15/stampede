#!/usr/bin/env node
// ONE-OFF, DELIBERATE integration test against the REAL live Kinsta dev
// backend (opts out of tools/cdp.js's default write-guard via
// allowBoardWrites: true) — per Adam's request (2026-08-27) to reproduce the
// #21-vs-#25 rank mismatch using the real lifecycle exactly as a player
// would experience it, with the [rank] debug logging now in place.
//
// Uses a clearly identifiable, fixed test identity (adjective "Gritty", noun
// "Anchor" — both real words from the closed pool) rather than a synthetic
// name, per the tools-audit's guidance for tests that genuinely need the
// real backend. Creates/updates exactly one row, tagged as obviously test
// data (see DATABASE.md's own note on the existing "Bubbly Jellyfish" test
// row in this same dev table).
//
// Does NOT touch localStorage's rank cache directly at any point — only
// Board.submit()/Board.rankOf() (invoked via syncRankRow()/openBoard(), the
// same functions a real run calls) are allowed to write it, so this
// exercises the real lifecycle, not a synthetic one.
//
// node tools/rank-real-repro.js

const { launchChrome, openPage, evaluate } = require("./cdp");

const SERVER = process.env.STAMPEDE_URL || "http://127.0.0.1:8000/index.html";
const VIEWPORT = { width: 412, height: 915, dsf: 2, mobile: true };

async function main() {
  const chrome = await launchChrome({});
  try {
    const { session } = await openPage({
      port: chrome.port,
      url: SERVER + "?debugRank",
      viewport: VIEWPORT,
      allowBoardWrites: true,   // deliberate: this test needs the real backend
    });
    const consoleLines = [];
    session.on("Runtime.consoleAPICalled", (p) => {
      const text = (p.args || []).map(a => {
        if (a.value !== undefined) return typeof a.value === "object" ? JSON.stringify(a.value) : String(a.value);
        return a.description || "";
      }).join(" ");
      consoleLines.push(text);
    });
    await new Promise(r => setTimeout(r, 500));

    // ---- Step 1: known state — a fresh, identifiable claim (score 0) ----
    const baseline = await evaluate(session, `
      (async () => {
        const rider = await Board.claim("Gritty", "Anchor");
        return { rider, meAfterClaim: Board.me() };
      })()
    `, { awaitPromise: true });
    console.log("=== Baseline (known state) ===");
    console.log(JSON.stringify(baseline, null, 2));

    // ---- Run 1: establishes a real best of 500 ----
    consoleLines.length = 0;
    const beforeRun1 = await evaluate(session, `Board.me().score`);
    await evaluate(session, `pendingScore = 500; syncRankRow();`);
    const afterSubmitRun1 = await evaluate(session, `Board.me().score`);
    // Wait for setRankFigures' async rankOf() to settle (retry logic can add
    // up to ~800ms; give it real headroom for the actual network round trip).
    await new Promise(r => setTimeout(r, 3000));
    const run1State = await evaluate(session, `
      ({ fRankText: document.getElementById("fRank").textContent, me: Board.me() })
    `);
    const run1Logs = consoleLines.filter(l => l.startsWith("[rank]"));

    await evaluate(session, `openBoard(true)`, { awaitPromise: true });
    await new Promise(r => setTimeout(r, 500));
    const run1Board = await evaluate(session, `
      (() => {
        const meRow = document.querySelector("#lbList .lbRow.me .lbPos");
        const youRow = document.querySelector("#lbYou .lbPos");
        return {
          topListPosition: meRow ? meRow.textContent : null,
          pinnedYouPosition: youRow ? youRow.textContent : null,
        };
      })()
    `);
    const run1BoardLogs = consoleLines.filter(l => l.startsWith("[rank]"));
    await evaluate(session, `closeBoard()`);

    console.log("\n=== Run 1 (score 500) ===");
    console.log("pendingScore: 500");
    console.log("stored best before submit:", beforeRun1);
    console.log("stored best after submit:", afterSubmitRun1);
    console.log("final displayed rank (fRank):", run1State.fRankText);
    console.log("stored rider after run 1:", JSON.stringify(run1State.me));
    console.log("leaderboard row position:", JSON.stringify(run1Board));
    console.log("[rank] logs during run 1 + board open:");
    run1BoardLogs.forEach(l => console.log("  " + l));

    // ---- Run 2: immediately, LOWER score of 300 — cache untouched by us ----
    consoleLines.length = 0;
    const beforeRun2 = await evaluate(session, `Board.me().score`);
    await evaluate(session, `pendingScore = 300; syncRankRow();`);
    const afterSubmitRun2 = await evaluate(session, `Board.me().score`);
    await new Promise(r => setTimeout(r, 3000));
    const run2State = await evaluate(session, `
      ({ fRankText: document.getElementById("fRank").textContent, me: Board.me() })
    `);

    await evaluate(session, `openBoard(true)`, { awaitPromise: true });
    await new Promise(r => setTimeout(r, 500));
    const run2Board = await evaluate(session, `
      (() => {
        const meRow = document.querySelector("#lbList .lbRow.me .lbPos");
        const youRow = document.querySelector("#lbYou .lbPos");
        return {
          topListPosition: meRow ? meRow.textContent : null,
          pinnedYouPosition: youRow ? youRow.textContent : null,
        };
      })()
    `);
    const run2Logs = consoleLines.filter(l => l.startsWith("[rank]"));
    await evaluate(session, `closeBoard()`);

    console.log("\n=== Run 2 (score 300, lower than run 1) ===");
    console.log("pendingScore: 300");
    console.log("stored best before submit:", beforeRun2);
    console.log("stored best after submit:", afterSubmitRun2);
    console.log("final displayed rank (fRank):", run2State.fRankText);
    console.log("stored rider after run 2:", JSON.stringify(run2State.me));
    console.log("leaderboard row position:", JSON.stringify(run2Board));
    console.log("[rank] logs during run 2 + board open:");
    run2Logs.forEach(l => console.log("  " + l));

    console.log("\n=== Verdict ===");
    const run1Pos = run1Board.topListPosition || run1Board.pinnedYouPosition;
    const run2Pos = run2Board.topListPosition || run2Board.pinnedYouPosition;
    const cardsAgree = run1State.fRankText === run2State.fRankText;
    const boardsAgree = run1Pos === run2Pos;
    const cardMatchesBoardRun2 = run2State.fRankText === ("#" + run2Pos);
    console.log("Results-card rank same across both runs:", cardsAgree, `(${run1State.fRankText} vs ${run2State.fRankText})`);
    console.log("Leaderboard position same across both runs:", boardsAgree, `(${run1Pos} vs ${run2Pos})`);
    console.log("Run 2's card matches run 2's leaderboard position:", cardMatchesBoardRun2);
  } finally {
    await new Promise((resolve) => {
      chrome.child.once("exit", resolve);
      chrome.child.kill();
    });
    require("node:fs").rmSync(chrome.userDataDir, { recursive: true, force: true, maxRetries: 3 });
  }
}

main().catch(e => { console.error(e); process.exit(1); });
