#!/usr/bin/env node
// Verifies the whirlpool loop-point fix: whirlpool.mp3 fades in/out at its
// own head and tail, so looping the whole buffer made every cycle audibly
// dip near-silent at the seam. Sound.loopStart() now sets loopSrc.loopStart/
// loopEnd to confine the REPEATING portion to the sustained middle, skipping
// the fades — the exact offsets are zero-crossing points measured against
// Chrome's own decodeAudioData output (see index.html's LOOP_TRIM comment),
// not the raw mp3 file, since decoders trim/resample differently.
//
// This inspects the real AudioBufferSourceNode Sound.loopStart() creates
// (via a createBufferSource() patch) rather than trusting the source code,
// since decodeAudioData's exact frame alignment is a browser-decoder detail
// this check should catch drifting.
//
// node tools/whirlpool-loop-trim-check.js

const { launchChrome, openPage, evaluate, VIEWPORTS } = require("./cdp");

const SERVER = process.env.STAMPEDE_URL || "http://127.0.0.1:8000/index.html";
const EXPECT_START = 0.0699;
const EXPECT_END = 1.4651;
const TOLERANCE = 0.005; // seconds — decode/frame-alignment slack

async function main() {
  const chrome = await launchChrome({});
  const pageExceptions = [];
  try {
    const { session } = await openPage({ port: chrome.port, url: SERVER, viewport: VIEWPORTS.phone412 });
    session.on("Runtime.exceptionThrown", (p) => pageExceptions.push(p.exceptionDetails.text));

    // Sound.unlock() runs at top-level module load (index.html:7412), which
    // kicks off the whirlpool.mp3 fetch+decode — poll until it lands rather
    // than sleeping a guessed duration.
    let node = null;
    for (let i = 0; i < 25 && !node; i++) {
      await new Promise(r => setTimeout(r, 200));
      node = await evaluate(session, `
        (() => {
          let captured = null;
          const proto = (window.AudioContext || window.webkitAudioContext).prototype;
          const real = proto.createBufferSource;
          proto.createBufferSource = function(){
            const n = real.call(this);
            captured = n;
            return n;
          };
          Sound.loopStart("whirlpool", 0.5);
          proto.createBufferSource = real;
          if (!captured || !captured.buffer) return null;
          const result = {
            loop: captured.loop,
            loopStart: captured.loopStart,
            loopEnd: captured.loopEnd,
            bufferDuration: captured.buffer.duration,
          };
          Sound.loopStop();
          return result;
        })()
      `);
    }

    await new Promise(r => setTimeout(r, 50)); // let any async exception land

    console.log(JSON.stringify({ node, pageExceptions }, null, 2));

    const ok =
      node !== null &&
      node.loop === true &&
      Math.abs(node.loopStart - EXPECT_START) < TOLERANCE &&
      Math.abs(node.loopEnd - EXPECT_END) < TOLERANCE &&
      node.bufferDuration > node.loopEnd &&
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
