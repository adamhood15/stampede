#!/usr/bin/env node
// Verifies the Whirlpool power-up end to end over the real DevTools protocol:
// pickup starts the 6s magnet -> nearby coins AND letters ease toward the
// rider's own lane/depth over several frames -> each is collected through
// its ordinary T.COIN/T.LETTER branch (score/word progress, entity removed)
// -> a survived hit does NOT cancel the effect (Adam's call, unlike Fast
// Pass's boost) -> a fatal hit (gameOver) DOES stop it, so the loop sound
// can't outlive the run.
//
// node tools/whirlpool-check.js

const { launchChrome, openPage, evaluate, VIEWPORTS } = require("./cdp");

const SERVER = process.env.STAMPEDE_URL || "http://127.0.0.1:8000/index.html";
const SKIP_LOADER = `dismissLoader();`;

async function main() {
  const chrome = await launchChrome({});
  const pageExceptions = [];
  try {
    const { session } = await openPage({ port: chrome.port, url: SERVER, viewport: VIEWPORTS.phone412 });
    session.on("Runtime.exceptionThrown", (p) => pageExceptions.push(p.exceptionDetails.text));
    await new Promise(r => setTimeout(r, 400));

    await evaluate(session, `
      Board.claim("Test Rider");
      ${SKIP_LOADER}
      start();
      lane = 0; laneA = 0;
    `);

    // 1. Pickup starts the timer and the magnet begins pulling a nearby coin
    // AND a nearby letter, both planted off to one side, several units
    // ahead — outside the ordinary pickup window, which is the whole point
    // of the magnet.
    const pickup = await evaluate(session, `
      (() => {
        const before = { whirlpoolT, coins, gotLetters };
        add(T.WHIRLPOOL, travelled + 0.05, 0);
        const coinE = add(T.COIN, travelled + 4, 1);     // off-lane, 4 units ahead
        const letterE = add(T.LETTER, travelled + 4, -1); // off-lane, opposite side
        letterE.gi = gotLetters;                          // the next letter the word needs
        update(0.016);
        const afterPickup = {
          whirlpoolT, entLeft: ents.some(e => e.t === T.WHIRLPOOL && !e.dead),
        };
        for (let i = 0; i < 240 && !(coinE.dead && letterE.dead); i++){
          update(0.016);
        }
        return {
          before, afterPickup,
          coinCollected: coinE.dead, coinsAfter: coins,
          letterCollected: letterE.dead, gotLettersAfter: gotLetters,
        };
      })()
    `);

    // 2. A SURVIVED hit must NOT cancel the magnet (Adam's explicit call).
    const survivedHit = await evaluate(session, `
      (() => {
        whirlpoolT = 3.2; lives = 3; invuln = 0;
        const before = whirlpoolT;
        hitRider();
        return { before, after: whirlpoolT, livesLeft: lives };
      })()
    `);

    // 3. A FATAL hit (gameOver) must stop it — nothing else ever will once
    // state leaves "play".
    const fatalHit = await evaluate(session, `
      (() => {
        whirlpoolT = 4.0; lives = 1; invuln = 0;
        const before = whirlpoolT;
        hitRider();
        return { before, after: whirlpoolT, state };
      })()
    `);

    // 4. Rendering the active cue and the world pickup's own glow must not throw.
    await evaluate(session, `
      reset(); state = "play";
      add(T.WHIRLPOOL, travelled + 3, 0);
      whirlpoolT = 3; whirlpoolAngle = 1.2;
      for (let i = 0; i < 30; i++){ update(0.016); render(); }
      true
    `);

    await new Promise(r => setTimeout(r, 50));   // let any async exception land

    console.log(JSON.stringify({ pickup, survivedHit, fatalHit, pageExceptions }, null, 2));

    const ok =
      pickup.before.whirlpoolT === 0 &&
      pickup.afterPickup.whirlpoolT === 6.0 &&   // granted THIS frame; decrement runs from the next frame on
      pickup.afterPickup.entLeft === false &&
      pickup.coinCollected === true &&                       // the planted coin swirled in and was collected
      pickup.coinsAfter > pickup.before.coins &&
      pickup.letterCollected === true &&                     // the planted letter was pulled in too
      pickup.gotLettersAfter > pickup.before.gotLetters &&
      survivedHit.after === survivedHit.before &&            // untouched by a survivable hit
      survivedHit.livesLeft === 2 &&                         // a normal hit still costs a life either way
      fatalHit.after === 0 &&                                // cleared once the run actually ends
      fatalHit.state === "dying" &&
      pageExceptions.length === 0;

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
