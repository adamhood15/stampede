#!/usr/bin/env node
// Demonstrates the Season Pass outro (07-09) apparent-size bug found by
// tools/sprite-size-audit.js: frame 09 renders ~31% smaller on screen than
// frame 08 even though both are the same in-game pose sequence. Forces
// seasonPassT to the exact values that select frame index 6/7/8 in
// seasonPassFrame() (see index.html), holding travelled/lane/lift fixed so
// the three shots are otherwise pixel-identical except the rider sprite --
// an apples-to-apples live-render comparison, not a static-PNG comparison.
//
// node tools/seasonpass-outro-shrink-check.js

const fs = require("node:fs");
const path = require("node:path");
const { launchChrome, openPage, evaluate, VIEWPORTS } = require("./cdp");

const SERVER = process.env.STAMPEDE_URL || "http://127.0.0.1:8000/index.html";
const OUT_DIR = path.join(__dirname, "..", ".tmp-seasonpass-outro-check");

// seasonPassFrame()'s outro math: frame index = 6 + floor((SEASONPASS_OUTRO_DUR
// - seasonPassT) / (SEASONPASS_OUTRO_DUR/3)), so picking seasonPassT at the
// midpoint of each third lands squarely on that frame.
const TARGETS = [
  { label: "sp2 (season-pass_03, big celebration)", seasonPassIntroT: 1.75 },
  { label: "sp3 (season-pass_04, thumbs up)",        seasonPassIntroT: 1.25 },
  { label: "sp4 (season-pass_05, settling in)",      seasonPassIntroT: 0.75 },
  { label: "sp6 (season-pass_07, winding up)", seasonPassT: 1.5 },
  { label: "sp7 (season-pass_08, throwing it)", seasonPassT: 0.9 },
  { label: "sp8 (season-pass_09, tossed)",      seasonPassT: 0.3 },
];

async function main() {
  const chrome = await launchChrome({});
  fs.mkdirSync(OUT_DIR, { recursive: true });
  try {
    const { session } = await openPage({ port: chrome.port, url: SERVER, viewport: VIEWPORTS.phone412 });
    const pageExceptions = [];
    session.on("Runtime.exceptionThrown", (p) => pageExceptions.push(JSON.stringify(p.exceptionDetails)));
    await new Promise(r => setTimeout(r, 400));

    await evaluate(session, `
      dismissLoader();
      start();
      reset();
      state = "play";
      speed = 0;
      travelled = 100;
      lane = 0; laneA = 0;
      jumpT = -1; tuckT = 0; hurtT = 0; duckA = 0; eatT = 0;
      boostT = 0; whirlpoolT = 0;
      seasonPassIntroT = 0; seasonPassT = 9;   // invincible for the whole test,
                                                // closed before the loop sets its
                                                // own real target per iteration
      true
    `);

    await evaluate(session, `
      window.__spDrawCalls = [];
      const origDrawImage = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function(img, ...rest){
        if (img && /season-pass_0/.test(img.currentSrc || img.src || ""))
          window.__spDrawCalls.push({ src: img.currentSrc || img.src, args: rest });
        return origDrawImage.call(this, img, ...rest);
      };
      true
    `);

    for (const target of TARGETS) {
      const { label } = target;
      const setIntro = "seasonPassIntroT" in target;
      const assign = setIntro
        ? `seasonPassIntroT = ${target.seasonPassIntroT}; seasonPassT = 0;`
        : `seasonPassIntroT = 0; seasonPassT = ${target.seasonPassT};`;
      await evaluate(session, `window.__spDrawCalls.length = 0; ${assign} true`);
      await new Promise(r => setTimeout(r, 80));   // let a couple of rAFs repaint
      const drawCalls = await evaluate(session, `window.__spDrawCalls`);
      const debug = await evaluate(session, `
        (() => {
          const p = floorPt(travelled, laneA, riderLift());
          return {
            state, lives, hurtT, dieT, duckA, eatT, boostT, whirlpoolT,
            seasonPassIntroT, seasonPassT, travelled, speed, lane, laneA,
            frameIdx: seasonPassFrame(),
            riderX: p.x, riderY: p.y, riderS: p.s,
            imgRiderLoaded: !!IMG.rider,
            spImg: (() => {
              const im = IMG["sp" + seasonPassFrame()];
              return im && { src: im.currentSrc || im.src, complete: im.complete,
                             naturalWidth: im.naturalWidth, naturalHeight: im.naturalHeight,
                             width: im.width, height: im.height };
            })(),
            hurtImgTruthy: !!(hurtT > 0),
            dieBranchActive: (state === "dying" || state === "over"),
            pixelAtRider: (() => {
              const px = Math.round(p.x * DPR), py = Math.round(p.y * DPR);
              const size = 240;
              const d = ctx.getImageData(px - size / 2, py - size / 2, size, size).data;
              let orangePixels = 0, brightPixels = 0;
              for (let i = 0; i < d.length; i += 4) {
                const r = d[i], g = d[i + 1], b = d[i + 2];
                if (r > 190 && r - g > 50 && g - b > 15 && g < 170) orangePixels++;
                if (r > 230 && g > 230 && b > 230) brightPixels++;
              }
              return { px, py, size, orangePixels, brightPixels, totalPixels: size * size };
            })(),
          };
        })()
      `);
      const shot = await session.send("Page.captureScreenshot", { format: "png" });
      const file = path.join(OUT_DIR, `frame-${debug.frameIdx}.png`);
      fs.writeFileSync(file, Buffer.from(shot.data, "base64"));
      console.log(`${label} -> ${file}`);
      console.log(JSON.stringify({ ...debug, drawCalls }, null, 2));
    }
    console.log("pageExceptions:", pageExceptions);
  } finally {
    await new Promise((resolve) => {
      chrome.child.once("exit", resolve);
      chrome.child.kill();
    });
    fs.rmSync(chrome.userDataDir, { recursive: true, force: true, maxRetries: 3 });
  }
}

main().catch(e => { console.error(e); process.exit(1); });
