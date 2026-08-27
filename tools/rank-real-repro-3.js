#!/usr/bin/env node
// Follow-up to rank-real-repro-2.js: that run showed fRank="#10" immediately
// after a fixed 3000ms wait, while Board.me().rank was still null at that
// same instant, then later settled to a cache-confirmed 55. That is
// consistent with the 3000ms wait being too short and catching the
// "calculating" placeholder mid-cycle (setRankFigures cycles a random
// number via setInterval while Board.rankOf() is in flight) rather than a
// real second server answer. Re-tests the SAME real identity/lifecycle, but
// POLLS for the "calculating" class to actually clear from #fRank (i.e.
// waits exactly as long as a real, patient player would) instead of relying
// on a fixed sleep, and records the class alongside the text throughout so
// a mid-cycle read can't be mistaken for a settled one.
//
// node tools/rank-real-repro-3.js

const { launchChrome, openPage, evaluate } = require("./cdp");

const SERVER = process.env.STAMPEDE_URL || "http://127.0.0.1:8000/index.html";
const VIEWPORT = { width: 412, height: 915, dsf: 2, mobile: true };
const TOKEN = "969f7a9e3cb3e886542d4bdd18fd3f9c";
const NAME = "Gritty Anchor";

async function waitForSettled(session, timeoutMs = 15000) {
  const samples = [];
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const snap = await evaluate(session, `
      (() => {
        const el = document.getElementById("fRank");
        return { text: el.textContent, calculating: el.classList.contains("calculating"), t: Date.now() };
      })()
    `);
    samples.push(snap);
    if (!snap.calculating) return { settled: true, samples, final: snap };
    await new Promise(r => setTimeout(r, 150));
  }
  return { settled: false, samples, final: samples[samples.length - 1] };
}

async function main() {
  const chrome = await launchChrome({});
  try {
    const { session } = await openPage({
      port: chrome.port, url: SERVER + "?debugRank", viewport: VIEWPORT, allowBoardWrites: true,
    });
    const consoleLines = [];
    session.on("Runtime.consoleAPICalled", (p) => {
      const text = (p.args || []).map(a => a.value !== undefined
        ? (typeof a.value === "object" ? JSON.stringify(a.value) : String(a.value))
        : (a.description || "")).join(" ");
      consoleLines.push(text);
    });
    await new Promise(r => setTimeout(r, 500));

    // Reuse the real, already-claimed identity from the prior attempts.
    // Current server/local state: score 900, cached rank 55 (from
    // rank-real-repro-2.js). Seed local storage to that known state
    // explicitly rather than assuming it survived (this is a fresh browser
    // profile), so this run starts from the documented baseline.
    await evaluate(session, `
      localStorage.setItem("stampede.rider.v1", JSON.stringify({
        name: ${JSON.stringify(NAME)}, token: ${JSON.stringify(TOKEN)}, score: 900, at: Date.now(), rank: 55
      }));
    `);

    // A genuinely NEW higher score, so Board.submit() itself clears the
    // cached rank (the only way the real app ever does) and rankOf() is
    // forced to make a real network call — exactly what a player's
    // best-ever run does.
    consoleLines.length = 0;
    const before = await evaluate(session, `Board.me().score`);
    await evaluate(session, `pendingScore = 1200; syncRankRow();`);
    const afterSubmit = await evaluate(session, `Board.me().score`);

    const settleResult = await waitForSettled(session);
    const meAfterSettle = await evaluate(session, `Board.me()`);
    const rankLogsRun = consoleLines.filter(l => l.startsWith("[rank]"));

    console.log("=== Run (score 1200, forces a real new-best cache clear) ===");
    console.log("stored best before submit:", before);
    console.log("stored best after submit:", afterSubmit);
    console.log("settled within timeout:", settleResult.settled);
    console.log("sample count while waiting:", settleResult.samples.length);
    console.log("timeline (t offset ms, calculating, text):");
    const t0 = settleResult.samples[0].t;
    settleResult.samples.forEach(s => console.log(`  +${s.t - t0}ms  calculating=${s.calculating}  text=${s.text}`));
    console.log("FINAL settled fRank:", settleResult.final.text, " (calculating=" + settleResult.final.calculating + ")");
    console.log("Board.me() after settle:", JSON.stringify(meAfterSettle));
    console.log("[rank] logs:");
    rankLogsRun.forEach(l => console.log("  " + l));

    // Now open the real leaderboard and compare.
    consoleLines.length = 0;
    await evaluate(session, `openBoard(true)`, { awaitPromise: true });
    await new Promise(r => setTimeout(r, 800));
    const board = await evaluate(session, `
      (() => {
        const meRow = document.querySelector("#lbList .lbRow.me .lbPos");
        const youRow = document.querySelector("#lbYou .lbPos");
        return { topListPosition: meRow ? meRow.textContent : null, pinnedYouPosition: youRow ? youRow.textContent : null };
      })()
    `);
    const boardLogs = consoleLines.filter(l => l.startsWith("[rank]"));
    await evaluate(session, `closeBoard()`);

    console.log("\nleaderboard row position:", JSON.stringify(board));
    console.log("[rank] logs during board open:");
    boardLogs.forEach(l => console.log("  " + l));

    console.log("\n=== Verdict ===");
    const boardPos = board.topListPosition || board.pinnedYouPosition;
    console.log("Settled results-card rank matches leaderboard position:",
      settleResult.final.text === ("#" + boardPos), `(${settleResult.final.text} vs #${boardPos})`);
  } finally {
    await new Promise((resolve) => {
      chrome.child.once("exit", resolve);
      chrome.child.kill();
    });
    require("node:fs").rmSync(chrome.userDataDir, { recursive: true, force: true, maxRetries: 3 });
  }
}

main().catch(e => { console.error(e); process.exit(1); });
