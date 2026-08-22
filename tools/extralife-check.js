#!/usr/bin/env node
// Verifies the Extra Life power-up end to end over the real DevTools protocol:
// pickup -> fly to HUD -> tube appears -> a hit absorbs it (identical
// shake/flash/speed-penalty/hurt-sound to a normal hit, no life lost, the
// tube explodes instead of a life tube dimming) -> the NEXT hit costs a real
// life like normal -> the shared spawn clock never offers a second Extra Life
// while one is already held.
//
// node tools/extralife-check.js

const { launchChrome, openPage, evaluate, VIEWPORTS } = require("./cdp");

const SERVER = process.env.STAMPEDE_URL || "http://127.0.0.1:8000/index.html";
const SKIP_LOADER = `dismissLoader();`;

async function main() {
  const chrome = await launchChrome({});
  try {
    const { session } = await openPage({ port: chrome.port, url: SERVER, viewport: VIEWPORTS.phone412 });
    await new Promise(r => setTimeout(r, 400));

    await evaluate(session, `
      Board.claim("Test Rider");
      ${SKIP_LOADER}
      start();
      lane = 0; laneA = 0;
    `);

    // 1. Pickup -> flight -> landing.
    const pickup = await evaluate(session, `
      (() => {
        const before = { extraLife, tubesExtra: document.querySelectorAll('#tubes .tube.extra').length };
        add(T.EXTRALIFE, travelled + 0.05, 0);
        update(0.016);
        const afterPickup = { extraLife, flyerKinds: flyers.map(f => f.kind), entLeft: ents.some(e => e.t === T.EXTRALIFE && !e.dead) };
        for (let i = 0; i < 60; i++) updateFlyers(0.02);
        const afterLand = { extraLife, tubesExtra: document.querySelectorAll('#tubes .tube.extra').length, flyersLeft: flyers.length };
        return { before, afterPickup, afterLand };
      })()
    `);

    // 2. Absorb hit: same shake/flash/speed-penalty/hurt-pose as a normal hit,
    // no life lost, and the tube explodes rather than vanishing instantly.
    const absorb = await evaluate(session, `
      (() => {
        invuln = 0; shake = 0; hurtT = 0; speed = CONFIG.maxSpeed;
        boostT = 5; boostSuper = true; fastPassLabelT = 5;
        const before = { lives, extraLife, speed };
        hitRider();
        return {
          before,
          justAfter: {
            lives, extraLife, invuln, shake, hurtT,
            speedDropped: speed < before.speed,
            boostCleared: boostT === 0 && !boostSuper && fastPassLabelT === 0,
            tubeExploding: !!document.querySelector('#tubes .tube.extra.exploding'),
            tubeStillInDom: document.querySelectorAll('#tubes .tube.extra').length,
          },
        };
      })()
    `);
    // Let the .38s CSS explosion keyframe actually finish and remove the tube.
    await new Promise(r => setTimeout(r, 500));
    const afterExplode = await evaluate(session, `
      ({ tubesExtra: document.querySelectorAll('#tubes .tube.extra').length })
    `);

    // 3. The NEXT hit is a real one.
    const realHit = await evaluate(session, `
      (() => {
        invuln = 0;
        const before = lives;
        hitRider();
        return { before, lives, extraLife };
      })()
    `);

    const hits = { absorb, afterExplode, realHit };

    // 4. Spawn-clock gate: never offers T.EXTRALIFE while one is held.
    const spawnGate = await evaluate(session, `
      (() => {
        extraLife = true;
        let sawExtra = false;
        for (let i = 0; i < 50; i++) {
          powerupZ = travelled - 1;
          spawnPowerup();
          if (ents.some(e => e.t === T.EXTRALIFE && !e.dead)) sawExtra = true;
          ents = ents.filter(e => e.t !== T.EXTRALIFE);
        }
        extraLife = false;
        return { sawExtraWhileHeld: sawExtra };
      })()
    `);

    const exceptions = await evaluate(session, `window.__caughtExceptions || []`);

    console.log(JSON.stringify({ pickup, hits, spawnGate, exceptions }, null, 2));

    const ok =
      pickup.before.extraLife === false && pickup.before.tubesExtra === 0 &&
      pickup.afterPickup.extraLife === false &&           // not real until landed
      pickup.afterPickup.flyerKinds.includes("extralife") &&
      pickup.afterLand.extraLife === true &&
      pickup.afterLand.tubesExtra === 1 &&
      absorb.before.extraLife === true &&
      absorb.justAfter.lives === absorb.before.lives &&    // absorbed — no life lost
      absorb.justAfter.extraLife === false &&
      absorb.justAfter.invuln > 0 &&                       // same invuln as a normal hit
      absorb.justAfter.shake === 1 &&                      // same shake as a normal hit
      absorb.justAfter.hurtT === 1.4 &&                    // same hurt pose as a normal hit
      absorb.justAfter.speedDropped &&                     // same speed penalty as a normal hit
      absorb.justAfter.boostCleared &&                     // same boost-cancel as a normal hit
      absorb.justAfter.tubeExploding &&                    // the explosion, not an instant vanish
      absorb.justAfter.tubeStillInDom === 1 &&              // still there mid-explosion
      afterExplode.tubesExtra === 0 &&                     // gone once the animation finishes
      realHit.lives === realHit.before - 1 &&              // the NEXT hit is a real hit
      spawnGate.sawExtraWhileHeld === false;

    console.log(ok ? "\nPASS" : "\nFAIL");
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
