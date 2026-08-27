#!/usr/bin/env node
// Second attempt of tools/rank-real-repro.js, per Adam's request to try
// "several controlled attempts" before concluding the original #21-vs-#25
// mismatch was environmental/transient rather than a code bug.
//
// Reuses the SAME real test identity ("Gritty Anchor") captured from the
// first attempt's real /claim response, seeded directly rather than
// re-claiming — claiming again would create a second, separate row (the
// name is now taken) rather than continuing the same one. Only
// Board.submit()/Board.rankOf() (via syncRankRow()/openBoard()) are allowed
// to touch the rank cache — same rule as the first attempt.
//
// node tools/rank-real-repro-2.js

const { launchChrome, openPage, evaluate } = require("./cdp");

const SERVER = process.env.STAMPEDE_URL || "http://127.0.0.1:8000/index.html";
const VIEWPORT = { width: 412, height: 915, dsf: 2, mobile: true };
const TOKEN = "969f7a9e3cb3e886542d4bdd18fd3f9c";
const NAME = "Gritty Anchor";
const RUN1_SCORE = 900;
const RUN2_SCORE = 600;

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

    // Seed the existing real identity directly (no fresh claim), starting
    // its LOCAL record from score 0 so run 1 is unambiguously a new best —
    // note the server's own row for this token still holds whatever it was
    // left at by the first attempt (500), so run 1 here (900) is a real new
    // best server-side too.
    await evaluate(session, `
      localStorage.setItem("stampede.rider.v1", JSON.stringify({
        name: ${JSON.stringify(NAME)}, token: ${JSON.stringify(TOKEN)}, score: 0, at: Date.now()
      }));
    `);

    async function runOnce(label, score) {
      consoleLines.length = 0;
      const before = await evaluate(session, `Board.me().score`);
      await evaluate(session, `pendingScore = ${score}; syncRankRow();`);
      const afterSubmit = await evaluate(session, `Board.me().score`);
      await new Promise(r => setTimeout(r, 3000));
      const state = await evaluate(session, `
        ({ fRankText: document.getElementById("fRank").textContent, me: Board.me() })
      `);
      const runLogs = consoleLines.filter(l => l.startsWith("[rank]"));

      await evaluate(session, `openBoard(true)`, { awaitPromise: true });
      await new Promise(r => setTimeout(r, 500));
      const board = await evaluate(session, `
        (() => {
          const meRow = document.querySelector("#lbList .lbRow.me .lbPos");
          const youRow = document.querySelector("#lbYou .lbPos");
          return { topListPosition: meRow ? meRow.textContent : null, pinnedYouPosition: youRow ? youRow.textContent : null };
        })()
      `);
      const boardLogs = consoleLines.filter(l => l.startsWith("[rank]"));
      await evaluate(session, `closeBoard()`);

      console.log(`\n=== ${label} (score ${score}) ===`);
      console.log("pendingScore:", score);
      console.log("stored best before submit:", before);
      console.log("stored best after submit:", afterSubmit);
      console.log("final displayed rank (fRank):", state.fRankText);
      console.log("stored rider:", JSON.stringify(state.me));
      console.log("leaderboard row position:", JSON.stringify(board));
      console.log("[rank] logs:");
      boardLogs.forEach(l => console.log("  " + l));

      return { fRankText: state.fRankText, pos: board.topListPosition || board.pinnedYouPosition };
    }

    const run1 = await runOnce("Run 1", RUN1_SCORE);
    const run2 = await runOnce("Run 2", RUN2_SCORE);

    console.log("\n=== Verdict ===");
    console.log("Results-card rank same across both runs:", run1.fRankText === run2.fRankText, `(${run1.fRankText} vs ${run2.fRankText})`);
    console.log("Leaderboard position same across both runs:", run1.pos === run2.pos, `(${run1.pos} vs ${run2.pos})`);
    console.log("Run 2's card matches run 2's leaderboard position:", run2.fRankText === ("#" + run2.pos));
  } finally {
    await new Promise((resolve) => {
      chrome.child.once("exit", resolve);
      chrome.child.kill();
    });
    require("node:fs").rmSync(chrome.userDataDir, { recursive: true, force: true, maxRetries: 3 });
  }
}

main().catch(e => { console.error(e); process.exit(1); });
