#!/usr/bin/env node
// Verifies the win variant of the results card end to end over the real
// DevTools protocol: a run that spelled STAMPEDE goes straight to the
// results card (endRun() no longer detours through showReveal()), and its
// #overRider "out cold" slot is swapped for the animated #overHat
// (typhoon-hat-tilt.png) instead — while an unwon run keeps the original
// dizzy #overRider exactly as before, and showReveal()/#reveal stay intact
// as a parked, still-callable screen.
//
// node tools/winscreen-check.js

const fs = require("node:fs");
const path = require("node:path");
const { launchChrome, openPage, evaluate, VIEWPORTS } = require("./cdp");

const SERVER = process.env.STAMPEDE_URL || "http://127.0.0.1:8000/index.html";
const SKIP_LOADER = `dismissLoader();`;
const OUT_DIR = path.join(__dirname, "..", ".tmp-winscreen-check");

async function settle(session, ms) {
  await new Promise(r => setTimeout(r, ms));
}

async function main() {
  const chrome = await launchChrome({});
  const pageExceptions = [];
  fs.mkdirSync(OUT_DIR, { recursive: true });
  try {
    const { session } = await openPage({ port: chrome.port, url: SERVER, viewport: VIEWPORTS.phone412 });
    session.on("Runtime.exceptionThrown", (p) => pageExceptions.push(JSON.stringify(p.exceptionDetails)));
    await settle(session, 400);

    // No Board.claim() here — this check never touches the leaderboard, and
    // claiming the same fixed test name repeatedly against the real dev
    // backend (see other tools/*-check.js scripts) 400s once it's already
    // taken, which is a stale-test-data problem, not a bug in this feature.
    await evaluate(session, `
      ${SKIP_LOADER}
      start();
    `);

    // --- WIN: all WORD.length letters collected, run ends via endRun(). ---
    // Seed deathX/deathY off-slot first, the way a real crash would leave
    // them, so a mid-sequence screenshot can actually tell "drifting toward
    // the slot" apart from "never drawn at all" instead of both looking
    // like nothing happened to land near a coincidentally-close spot.
    await evaluate(session, `
      deathX = 40; deathY = 120; overTilt = 1;
      gotLetters = WORD.length; shownLetters = WORD.length;
      endRun();
      true
    `);
    await settle(session, 300);   // well before OVER_SNAP could ever be reached
    const winMidState = await evaluate(session, `({ overRiderDom, deathX, deathY })`);
    const winMidShot = await session.send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(OUT_DIR, "win-mid.png"), Buffer.from(winMidShot.data, "base64"));

    // handOverRider() waits for the crash-ease to settle before the swap —
    // up to OVER_HAND_MAX (5s) if he never quite gets within OVER_SNAP, which
    // is exactly what happens here since there was no real crash to seed
    // deathX/deathY. Give it real time since it's driven off the page's own
    // rAF loop.
    await settle(session, 5400);

    const winState = await evaluate(session, `
      (() => {
        const rider = getComputedStyle($("overRider"));
        const hat = getComputedStyle($("overHat"));
        return {
          overWon, overRiderDom, revealed, revealOpenAfterWin: revealOpen,
          panelHasWon: $("overPanel").classList.contains("won"),
          panelOn: $("overPanel").classList.contains("on"),
          riderDisplay: rider.display, hatDisplay: hat.display,
          hatFx: $("overHat").style.getPropertyValue("--fx"),
          hatFy: $("overHat").style.getPropertyValue("--fy"),
          overTitle: $("overTitle").textContent,
        };
      })()
    `);
    const winShot = await session.send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(OUT_DIR, "win.png"), Buffer.from(winShot.data, "base64"));

    // --- LOSE: fewer than WORD.length letters, same endRun() entry point. ---
    await evaluate(session, `
      reset(); state = "play";
      deathX = 40; deathY = 120; overTilt = 1;
      gotLetters = 3; shownLetters = 3;
      endRun();
      true
    `);
    await settle(session, 300);
    const loseMidState = await evaluate(session, `({ overRiderDom, deathX, deathY })`);
    const loseMidShot = await session.send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(OUT_DIR, "lose-mid.png"), Buffer.from(loseMidShot.data, "base64"));

    await settle(session, 5400);

    const loseState = await evaluate(session, `
      (() => {
        const rider = getComputedStyle($("overRider"));
        const hat = getComputedStyle($("overHat"));
        return {
          overWon, overRiderDom,
          panelHasWon: $("overPanel").classList.contains("won"),
          riderDisplay: rider.display, hatDisplay: hat.display,
          overTitle: $("overTitle").textContent,
        };
      })()
    `);
    const loseShot = await session.send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(OUT_DIR, "lose.png"), Buffer.from(loseShot.data, "base64"));

    // --- showReveal() stays reachable as a parked screen, not deleted. ---
    const revealStillWorks = await evaluate(session, `
      (() => {
        reset(); state = "play"; gotLetters = WORD.length; shownLetters = WORD.length;
        showReveal();
        return { revealOpen, panelOn: $("reveal").classList.contains("on") };
      })()
    `);

    await settle(session, 50);

    console.log(JSON.stringify(
      { winMidState, winState, loseMidState, loseState, revealStillWorks, pageExceptions },
      null, 2));

    const ok =
      winMidState.overRiderDom === false &&    // too early for the real handoff either way —
      loseMidState.overRiderDom === false &&   // the mid screenshots must come from drawRider(), not #overRider/#overHat
      winState.overWon === true &&
      winState.overRiderDom === true &&
      winState.panelHasWon === true &&
      winState.riderDisplay === "none" &&
      winState.hatDisplay === "block" &&
      winState.hatFx !== "" && winState.hatFy !== "" &&
      winState.overTitle === "Nice Ride, Partner" &&
      winState.revealed === false &&          // showReveal() was never invoked
      loseState.overWon === false &&
      loseState.panelHasWon === false &&
      loseState.riderDisplay === "block" &&
      loseState.hatDisplay === "none" &&
      loseState.overTitle === "Wipeout" &&
      revealStillWorks.revealOpen === true &&
      revealStillWorks.panelOn === true &&
      pageExceptions.length === 0;

    console.log(ok ? "\nPASS" : "\nFAIL");
    console.log(`Screenshots: ${OUT_DIR}`);
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
