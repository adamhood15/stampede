#!/usr/bin/env node
// Verifies the Extra Life pickup's pizza-eating flourish over the real
// DevTools protocol: eatT/EAT_DUR get set and Sound.eating() fires the
// INSTANT the pickup is grabbed on the track -- not a beat later once the
// flyer finishes its flight to the HUD (extraLife/Sound.extraLife() still
// wait for that landing; only the eating cue moved earlier). Also checks the
// rider steps through all 4 eat frames (EAT_REG-registered, tube-pinned) and
// that Sound.eating() chains typhoon-slurp.mp3 onto typhoon-eating.mp3's own
// `ended` event, not two independent calls.
//
// node tools/extralife-eat-check.js

const { launchChrome, openPage, evaluate, VIEWPORTS } = require("./cdp");

const SERVER = process.env.STAMPEDE_URL || "http://127.0.0.1:8000/index.html";
const SKIP_LOADER = `dismissLoader();`;
// Seeds the rider directly rather than calling Board.claim(), which is a
// real network call against the live Kinsta dev backend (DATABASE.md) that
// this power-up check has no reason to depend on -- it never reaches
// showOver()/Board.submit(), so no rank caching is needed either.
const SEED_RIDER = `localStorage.setItem("stampede.rider.v1", JSON.stringify({
  name: "Test Rider", token: "test-token", score: 0, at: Date.now()
}));`;

async function main() {
  const chrome = await launchChrome({});
  try {
    const { session } = await openPage({ port: chrome.port, url: SERVER, viewport: VIEWPORTS.phone412 });
    await new Promise(r => setTimeout(r, 400));

    // Record every play() call by src (the <audio>-element fallback path)
    // AND every AudioBufferSourceNode.start() call (the web-audio path Sound
    // actually takes once fetch+decode has landed, which is the common case).
    // Whichever path Sound.eating() used, we need to catch the node/element it
    // set an onended/ended hook on, so we can fire that hook ourselves and
    // confirm slurp starts right off the back of it -- not two independent
    // calls with a guessed delay between them.
    await evaluate(session, `
      window.__plays = [];
      window.__lastEl = null;
      window.__starts = [];
      const origPlay = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function(){
        const src = this.currentSrc || this.src || "";
        window.__plays.push(src.split("/").pop());
        window.__lastEl = this;
        return origPlay.apply(this, arguments);
      };
      const origStart = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function(){
        const node = this;
        window.__starts.push(node);
        return origStart.apply(this, arguments);
      };
      ${SEED_RIDER}
      ${SKIP_LOADER}
      start();
      lane = 0; laneA = 0;
    `);

    // Pickup ONLY -- no flight iterations yet. eatT/Sound.eating() must have
    // already fired here; extraLife must NOT be true yet (that still waits
    // for the flyer to land in the HUD).
    const grabbed = await evaluate(session, `
      (() => {
        add(T.EXTRALIFE, travelled + 0.05, 0);
        update(0.016);
        const chainedIdx = window.__starts.findIndex(n => !!n.onended);
        return {
          extraLife, eatT, EAT_DUR,
          plays: window.__plays.slice(),
          hasChainedWebAudioSource: chainedIdx >= 0,
          flyerKinds: flyers.map(f => f.kind),
          entLeft: ents.some(e => e.t === T.EXTRALIFE && !e.dead),
        };
      })()
    `);

    // Now run the eat freeze out to its last instant and let update() fire
    // its onEnd -- flyExtraLife() is deferred there (see index.html's
    // update()), not spawned at the grab, so the flyer doesn't exist until
    // the chomp actually finishes. Jumping eatT to the freeze's last instant
    // rather than pumping ~150 real frames keeps this deterministic (no
    // organically-spawned hazard can land on the rider in between).
    const chomped = await evaluate(session, `
      (() => {
        eatT = 0.001;
        update(1/60);
        return { eatT, flyerKinds: flyers.map(f => f.kind) };
      })()
    `);

    // Then run the flyer's flight to completion -- extraLife should flip
    // true here, with no second eatT/Sound.eating() firing.
    const landed = await evaluate(session, `
      (() => {
        for (let i = 0; i < 60; i++) updateFlyers(0.02);
        return {
          extraLife,
          startsCount: window.__starts.length,
        };
      })()
    `);

    // Step eatT down through its full range and sample which eat frame
    // drawRider would pick at each point, via the same quadIdx math it uses.
    const frames = await evaluate(session, `
      (() => {
        const seen = [];
        for (const frac of [0.99, 0.74, 0.49, 0.24, 0.0]) {
          eatT = EAT_DUR * frac;
          const ei = eatT > 0 ? quadIdx(1 - eatT / EAT_DUR) : -1;
          seen.push({ frac, ei, img: ei >= 0 ? !!IMG["eat" + ei] : null });
        }
        return seen;
      })()
    `);

    // Priority: per Adam, duck is the ONLY thing that should cut the eating
    // pose short -- jump, whirlpool spin, and speed boost must all let it
    // play out instead. Mirrors drawRider()'s own gating chain (dieImg/
    // hurtImg forced off via state="play"/hurtT=0) against each competing
    // state in turn, checked in isolation so one conflict can't mask another.
    const priority = await evaluate(session, `
      (() => {
        state = "play"; hurtT = 0; dieT = 0;
        const pick = () => {
          const duckImg = duckA > 0.05 ? IMG["duck" + duckIdx(duckA)] : null;
          const eatImg  = (!duckImg && eatT > 0) ? IMG["eat" + quadIdx(1 - eatT / EAT_DUR)] : null;
          const flipImg = (!duckImg && !eatImg && jumpT >= 0) ? IMG["flip" + flipFrame(jumpT / JUMP_DUR)] : null;
          const spinImg = (!duckImg && !eatImg && !flipImg && whirlpoolT > 0) ? IMG["spin" + spinFrame(performance.now() * 0.001)] : null;
          const speedImg= (!duckImg && !eatImg && !flipImg && !spinImg && boostT > 0) ? IMG["speed" + speedFrame(boostT)] : null;
          return { duck: !!duckImg, eat: !!eatImg, jump: !!flipImg, spin: !!spinImg, speed: !!speedImg };
        };
        duckA = 0; eatT = 0; jumpT = -1; whirlpoolT = 0; boostT = 0;
        const eatVsDuck = (() => { duckA = 0.6; eatT = EAT_DUR * 0.5; return pick(); })();
        duckA = 0; eatT = 0;
        const eatVsJump = (() => { eatT = EAT_DUR * 0.5; jumpT = JUMP_DUR * 0.3; return pick(); })();
        jumpT = -1; eatT = 0;
        const eatVsSpin = (() => { eatT = EAT_DUR * 0.5; whirlpoolT = 3; return pick(); })();
        whirlpoolT = 0; eatT = 0;
        const eatVsSpeed = (() => { eatT = EAT_DUR * 0.5; boostT = 2; return pick(); })();
        boostT = 0; eatT = 0;
        return { eatVsDuck, eatVsJump, eatVsSpin, eatVsSpeed };
      })()
    `);

    // Simulate the eating sample finishing -- fire whichever hook
    // Sound.eating() actually wired (web-audio node.onended, or the
    // <audio>-element fallback's 'ended' listener), and confirm slurp starts
    // right off the back of it, not on an independent guessed delay.
    const chained = await evaluate(session, `
      (() => {
        const before = window.__starts.length;
        const node = window.__starts.find(n => !!n.onended);
        if (node) node.onended();
        if (window.__lastEl) window.__lastEl.dispatchEvent(new Event("ended"));
        return {
          plays: window.__plays.slice(),
          startsBefore: before,
          startsAfter: window.__starts.length,
        };
      })()
    `);

    const exceptions = await evaluate(session, `window.__caughtExceptions || []`);

    console.log(JSON.stringify({ grabbed, chomped, landed, frames, priority, chained, exceptions }, null, 2));

    // Whichever path Sound.eating() actually took must show BOTH: eating
    // started at pickup, and slurp only starts once eating's own end hook
    // fires -- never both at once, never slurp first.
    const eatingStartedViaWebAudio = grabbed.hasChainedWebAudioSource;
    const eatingStartedViaElement = grabbed.plays.includes("typhoon-eating.mp3");
    const slurpChainedViaWebAudio = chained.startsAfter === chained.startsBefore + 1;
    const slurpChainedViaElement = chained.plays[chained.plays.length - 1] === "typhoon-slurp.mp3";

    const ok =
      grabbed.extraLife === false &&                   // shield still waits for the flyer to land
      grabbed.eatT > 0 && grabbed.eatT <= grabbed.EAT_DUR &&   // but eating fired right on the grab
      grabbed.entLeft === false &&                      // the world pickup is gone the instant it's grabbed
      grabbed.flyerKinds.length === 0 &&                // and no badge stands in for it during the chomp
      (eatingStartedViaWebAudio || eatingStartedViaElement) &&
      !grabbed.plays.includes("typhoon-slurp.mp3") &&   // not fired yet -- only on ended
      chomped.flyerKinds.includes("extralife") &&        // badge takes flight only once the chomp ends
      landed.extraLife === true &&                      // NOW the shield goes live
      landed.startsCount === chained.startsBefore &&    // landing itself started no new sound
      frames.every(f => f.ei >= -1 && f.ei <= 3 && f.img !== false) &&
      frames.map(f => f.ei).join(",") === "0,1,2,3,-1" &&
      (eatingStartedViaWebAudio ? slurpChainedViaWebAudio : slurpChainedViaElement) &&
      // Duck cuts eat short; jump/spin/speed boost all let it play out.
      priority.eatVsDuck.duck === true && priority.eatVsDuck.eat === false &&
      priority.eatVsJump.eat === true && priority.eatVsJump.jump === false &&
      priority.eatVsSpin.eat === true && priority.eatVsSpin.spin === false &&
      priority.eatVsSpeed.eat === true && priority.eatVsSpeed.speed === false &&
      exceptions.length === 0;

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
