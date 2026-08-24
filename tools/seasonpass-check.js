#!/usr/bin/env node
// Verifies the Season Pass power-up's two-phase timing over the real
// DevTools protocol:
// - grabbing it freezes the world (seasonPassIntroT) rather than starting the
//   mechanical effect immediately -- travelled/speed/collisions all hold
//   still while the reveal animation (sp0-sp5) steps through
// - the freeze ends and the world resumes exactly when seasonPassIntroT hits
//   0, at which point seasonPassT (the real effect) starts, its music takes
//   the channel, and the rider holds on sp5 (season-pass_06)
// - only NOW is the player actually invincible / faster / magnetic -- a hit
//   during the frozen reveal would be a bug (nothing should be able to touch
//   the rider while the world is frozen anyway, but the guard is checked)
// - it only ever spawns once per run
// - the outro (sp6-sp8) plays in the last SEASONPASS_OUTRO_DUR of seasonPassT
//   and the whole effect + its music end together
//
// node tools/seasonpass-check.js

const { launchChrome, openPage, evaluate, VIEWPORTS } = require("./cdp");

const SERVER = process.env.STAMPEDE_URL || "http://127.0.0.1:8000/index.html";
const SKIP_LOADER = `dismissLoader();`;

function ok(label, cond, detail) {
  console.log((cond ? "PASS" : "FAIL") + " - " + label + (detail !== undefined ? " (" + JSON.stringify(detail) + ")" : ""));
  return cond;
}

async function main() {
  const chrome = await launchChrome({});
  let allPass = true;
  try {
    const { session } = await openPage({ port: chrome.port, url: SERVER, viewport: VIEWPORTS.phone412 });
    await new Promise(r => setTimeout(r, 400));

    await evaluate(session, `
      window.__safeCount = 0;
      const origSeasonPassSafe = Sound.seasonPassSafe.bind(Sound);
      Sound.seasonPassSafe = function(){ window.__safeCount++; return origSeasonPassSafe(); };
      Board.claim("Test Rider");
      ${SKIP_LOADER}
      start();
      lane = 0; laneA = 0;
    `);

    // --- Pickup: starts the FROZEN intro, not the mechanical effect ---
    const grabbed = await evaluate(session, `
      (() => {
        add(T.SEASONPASS, travelled + 0.05, 0);
        update(0.016);
        return { seasonPassIntroT, seasonPassT, travelledAfter: travelled };
      })()
    `);
    allPass &= ok("pickup starts the frozen intro, not the effect", grabbed.seasonPassIntroT > 2.9 && grabbed.seasonPassT === 0, grabbed);

    // --- World is frozen during intro: travelled should not advance over many frames ---
    const frozen = await evaluate(session, `
      (() => {
        const before = travelled;
        for (let i = 0; i < 60; i++) update(0.016);   // ~0.96s, still well inside the 3s intro
        return { before, after: travelled, seasonPassIntroT };
      })()
    `);
    allPass &= ok("travelled does not advance during the frozen reveal", frozen.after === frozen.before, frozen);
    allPass &= ok("still mid-intro after ~1s of a 3s intro", frozen.seasonPassIntroT > 1.9 && frozen.seasonPassIntroT < 2.1, frozen);

    // --- Reveal animation steps through frames during the freeze ---
    const introFrame = await evaluate(session, `seasonPassFrame()`);
    allPass &= ok("reveal animation is mid-way through 01-06 partway into the intro", introFrame >= 1 && introFrame <= 4, introFrame);

    // --- A hazard during the freeze can't touch the rider (nothing collides -- collision loop doesn't run) ---
    const duringFreeze = await evaluate(session, `
      (() => {
        const livesBefore = lives;
        add(T.COW, travelled + 0.05, 0);   // would be in the hit window if collisions ran
        for (let i = 0; i < 10; i++) update(0.016);
        return { livesBefore, livesAfter: lives, seasonPassIntroT };
      })()
    `);
    allPass &= ok("no life lost during the frozen reveal (collision loop doesn't run)", duringFreeze.livesAfter === duringFreeze.livesBefore, duringFreeze);

    // --- Run the intro out: world resumes, effect + music start, frame holds on index 5 ---
    const resumed = await evaluate(session, `
      (() => {
        while (seasonPassIntroT > 0.02) update(0.016);
        update(0.05);   // cross the 0 boundary
        return { seasonPassIntroT, seasonPassT, frame: seasonPassFrame() };
      })()
    `);
    allPass &= ok("world resumes into the effect once the intro ends", resumed.seasonPassIntroT === 0 && resumed.seasonPassT > 8.9, resumed);
    allPass &= ok("rider holds on frame index 5 (season-pass_06) right after resuming", resumed.frame === 5, resumed);

    // --- Now travelled DOES advance, and speed climbs toward 1.5x maxSpeed ---
    const speedState = await evaluate(session, `
      (() => { const t0 = travelled; for (let i = 0; i < 400; i++) update(0.016); return { advanced: travelled > t0, speed, maxSpeed: CONFIG.maxSpeed }; })()
    `);
    allPass &= ok("travelled advances once resumed", speedState.advanced, speedState);
    allPass &= ok("speed climbs toward 1.5x maxSpeed", Math.abs(speedState.speed - speedState.maxSpeed * 1.5) < 0.05, speedState);

    // --- Invincibility now that the effect is truly active ---
    const beforeLives = await evaluate(session, "lives");
    await evaluate(session, `
      (() => { window.__safeCount = 0; add(T.COW, travelled + 0.05, 0); update(0.016); })()
    `);
    const afterHit = await evaluate(session, `({ lives, safeCount: window.__safeCount })`);
    allPass &= ok("cow hit during the active effect costs no life", afterHit.lives === beforeLives, { beforeLives, afterHit });
    allPass &= ok("cow hit during the active effect fires the safe cue", afterHit.safeCount >= 1, afterHit);

    // --- Run the effect out: outro frames, then everything ends together ---
    const expiry = await evaluate(session, `
      (() => {
        while (seasonPassT > 0.02) update(0.016);
        const frameJustBefore = seasonPassFrame();
        update(0.05);
        return { frameJustBefore, seasonPassT };
      })()
    `);
    allPass &= ok("animation reaches the last frame (index 8) as the effect ends", expiry.frameJustBefore === 8, expiry);
    allPass &= ok("seasonPassT reaches exactly 0", expiry.seasonPassT === 0, expiry);

    // --- One-per-run ---
    const onceState = await evaluate(session, `
      (() => {
        reset(); state = "play";
        seasonPassSpawned = true;
        let sawSeasonPassAgain = false;
        for (let i = 0; i < 400; i++){
          ents = ents.filter(e => e.t !== T.SEASONPASS);
          powerupZ = travelled - 1;
          spawnPowerup();
          if (ents.some(e => e.t === T.SEASONPASS)) sawSeasonPassAgain = true;
          travelled += 1;
        }
        return { sawSeasonPassAgain };
      })()
    `);
    allPass &= ok("Season Pass never spawns again once seasonPassSpawned is set", !onceState.sawSeasonPassAgain, onceState);

    console.log(allPass ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED");
    process.exitCode = allPass ? 0 : 1;
  } finally {
    try { chrome.child.kill(); } catch (e) {}
  }
}

main().catch(e => { console.error(e); process.exit(1); });
