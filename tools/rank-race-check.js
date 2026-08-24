#!/usr/bin/env node
// Verifies the fix for the "results card shows the old rank" bug: two runs
// finished back-to-back fire two overlapping /rank lookups, and the slower
// one (for the WORSE, earlier score) used to win if it resolved after the
// faster one (for the BETTER, later score) — both by overwriting the DOM
// figure and by corrupting the cached rider record in localStorage. Fixed by
// setRankFigures()'s requestId guard and rankOf()'s re-read-before-write.
//
// Also checks the "calculating" cue itself: the figure should visibly cycle
// through random numbers while a lookup is in flight (not just sit on the
// stale one), the superseded run 1 cycle should go inert the instant run 2
// starts rather than fight it for the DOM, and prefers-reduced-motion should
// suppress the cycling entirely.
//
// fetch is stubbed in-page so the race is deterministic and no synthetic
// scores hit the live dev DB (see DATABASE.md's API-endpoint note).
//
// node tools/rank-race-check.js

const { launchChrome, openPage, evaluate, VIEWPORTS } = require("./cdp");

const SERVER = process.env.STAMPEDE_URL || "http://127.0.0.1:8000/index.html";

async function main() {
  const chrome = await launchChrome({});
  try {
    const { session } = await openPage({ port: chrome.port, url: SERVER, viewport: VIEWPORTS.phone412 });
    await new Promise(r => setTimeout(r, 400));

    const result = await evaluate(session, `
      (async () => {
        const realFetch = window.fetch.bind(window);
        window.fetch = (url, opts) => {
          const u = String(url);
          // Run 1: worse score, SLOW response — arrives after run 2's.
          if (u.includes("/rank?score=100")) {
            return new Promise(resolve => setTimeout(() =>
              resolve(new Response(JSON.stringify({ rank: 15 }), { status: 200 })), 400));
          }
          // Run 2: better score, FAST response — should win.
          if (u.includes("/rank?score=200")) {
            return new Promise(resolve => setTimeout(() =>
              resolve(new Response(JSON.stringify({ rank: 10 }), { status: 200 })), 20));
          }
          // Reduced-motion scenario's single slow lookup.
          if (u.includes("/rank?score=300")) {
            return new Promise(resolve => setTimeout(() =>
              resolve(new Response(JSON.stringify({ rank: 7 }), { status: 200 })), 300));
          }
          if (u.includes("/submit")) {
            return Promise.resolve(new Response("{}", { status: 200 }));
          }
          return realFetch(url, opts);
        };

        localStorage.setItem("stampede.rider.v1",
          JSON.stringify({ name: "Testy", token: "testtoken", score: 0, at: Date.now() }));

        const el = document.getElementById("fRank");

        pendingScore = 100;
        syncRankRow();                                  // run 1 finishes
        const midFlightClass = el.classList.contains("calculating");
        const midFlightMeScore = Board.me().score;

        // Sample the figure a few times while run 1's lookup is the only one
        // in flight — the cycling effect should be visibly changing it.
        const run1Samples = [el.textContent];
        for (let i = 0; i < 4; i++) {
          await new Promise(r => setTimeout(r, 40));
          run1Samples.push(el.textContent);
        }
        const run1Cycled = new Set(run1Samples).size > 1;

        pendingScore = 200;
        syncRankRow();                                   // run 2 finishes moments later

        await new Promise(r => setTimeout(r, 500));      // let both lookups settle

        const raceResult = {
          midFlightClass, midFlightMeScore, run1Cycled,
          finalText: el.textContent,
          finalClass: el.className,
          meScore: Board.me().score,
          meRank: Board.me().rank,
        };

        // Reduced motion: the cycling should not run at all — the figure
        // sits still on whatever it last showed until the real rank lands.
        const realMatchMedia = window.matchMedia;
        window.matchMedia = (q) => ({ matches: q.includes("prefers-reduced-motion"), addListener(){}, removeListener(){} });
        try {
          pendingScore = 300;
          el.textContent = "#10";                         // known starting value to watch for changes
          syncRankRow();
          const reducedSamples = [el.textContent];
          for (let i = 0; i < 4; i++) {
            await new Promise(r => setTimeout(r, 40));
            reducedSamples.push(el.textContent);
          }
          const reducedStaticMidFlight = new Set(reducedSamples).size === 1;
          await new Promise(r => setTimeout(r, 400));      // let the slow lookup land
          var reducedResult = { reducedStaticMidFlight, finalText: el.textContent };
        } finally {
          window.matchMedia = realMatchMedia;
        }

        return { raceResult, reducedResult };
      })()
    `, { awaitPromise: true });

    console.log(JSON.stringify(result, null, 2));
    const { raceResult, reducedResult } = result;

    const ok =
      raceResult.midFlightClass === true &&               // cycling while run 1's lookup was pending
      raceResult.midFlightMeScore === 100 &&               // submit(100) landed before run 2 started
      raceResult.run1Cycled === true &&                    // the figure actually changed, not just a class
      raceResult.finalText === "#10" &&                    // run 2's rank won, not run 1's stale #15
      !raceResult.finalClass.includes("calculating") &&    // settled, not left mid-animation
      raceResult.meScore === 200 &&                        // rider record has the later run's score
      raceResult.meRank === 10 &&                          // ...and its correct rank, not stomped by run 1
      reducedResult.reducedStaticMidFlight === true &&     // reduced motion: no cycling
      reducedResult.finalText === "#7";                    // ...but the real rank still lands

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
