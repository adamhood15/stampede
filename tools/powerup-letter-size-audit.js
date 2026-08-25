#!/usr/bin/env node
// Power-up / letter size audit (see TODOLIST.md: "ensure that letters and
// power-ups are uniform in the size that they render, be sure to account
// for glow effects"). Same principle as sprite-size-audit.js: raw PNG pixel
// dimensions are a red herring (whirlpool.png and season-pass.png aren't
// remotely the same shape or padding), the real invariant is what
// drawEntInner() actually puts on screen.
//
// Icons (fastPass/souvenir/extraLife/whirlpool/seasonPass): dh = H*s*grow,
// dw = dh*(img.width/img.height) — the whole native PNG is drawn, so
// k = dh/img.height is the single per-icon scale factor (drawImage never
// distorts aspect). Multiplying k^2 by that PNG's own opaque-pixel COUNT
// gives the actual on-screen silhouette area.
//
// Letters (lt1-lt8): dh = h, dw = h*(WORD_SRC.w[idx]/WORD_SRC.h), cropped
// from the source at WORD_SRC.y/WORD_SRC.h, so k = h/WORD_SRC.h. Opaque
// count is over that same crop region, not the whole canvas.
//
// Glows are procedural (radial gradients / vector shapes keyed off h at
// draw time), not baked into the PNGs, so their reach can't be measured
// from pixels — this tool reports each one's own outer-radius formula
// (as a multiple of its icon's h) read directly from the constants each
// glow function draws with, so the reach ratios can be compared the same
// way the icon areas are.
//
// node tools/powerup-letter-size-audit.js

const { launchChrome, openPage, evaluate, VIEWPORTS } = require("./cdp");

const SERVER = process.env.STAMPEDE_URL || "http://127.0.0.1:8000/index.html";

async function main() {
  const chrome = await launchChrome({});
  try {
    const { session } = await openPage({ port: chrome.port, url: SERVER, viewport: VIEWPORTS.phone412 });
    await new Promise(r => setTimeout(r, 400));

    const result = await evaluate(session, `
      (async () => {
        function measure(img, x0, y0, w0, h0){
          const c = document.createElement("canvas");
          c.width = w0; c.height = h0;
          const cx = c.getContext("2d");
          cx.drawImage(img, x0, y0, w0, h0, 0, 0, w0, h0);
          const data = cx.getImageData(0, 0, w0, h0).data;
          let n = 0, minX = w0, maxX = -1, minY = h0, maxY = -1;
          for (let y = 0; y < h0; y++){
            for (let x = 0; x < w0; x++){
              const a = data[(y * w0 + x) * 4 + 3];
              if (a < 16) continue;
              n++;
              if (x < minX) minX = x; if (x > maxX) maxX = x;
              if (y < minY) minY = y; if (y > maxY) maxY = y;
            }
          }
          // bbox is inclusive of the last opaque pixel -> +1 for a true span
          const bboxW = maxX >= minX ? (maxX - minX + 1) : 0;
          const bboxH = maxY >= minY ? (maxY - minY + 1) : 0;
          return { opaquePx: n, bboxW, bboxH };
        }

        const icons = {
          fastPass:   { img: IMG.fastPass,   H: FASTPASS_H,   glowR: FASTPASS_GLOW_R,  glowNote: "fastPassGlow halo, 0.92-1.08x pulse" },
          souvenir:   { img: IMG.souvenir,   H: SOUVENIR_H,   glowR: SOUVENIR_GLOW_R,  glowNote: "souvenirGlow halo, 0.94-1.06x pulse" },
          extraLife:  { img: IMG.extraLife,  H: EXTRALIFE_H,  glowR: null,  glowNote: "smell lines, not a radial halo (riseH = h*1.9 vertical)" },
          whirlpool:  { img: IMG.whirlpool,  H: WHIRLPOOL_H,  glowR: WHIRLPOOL_SWIRL_R, glowNote: "whirlpoolHalo swirl, static" },
          seasonPass: { img: IMG.seasonPass, H: SEASONPASS_H, glowR: SEASONPASS_HALO_R,  glowNote: "seasonPassGlow halo (core " + SEASONPASS_CORE_R + ", rings transient to " + (SEASONPASS_RING_BASE + SEASONPASS_RING_RANGE).toFixed(2) + ")" },
        };
        const iconOut = {};
        for (const [name, { img, H, glowR, glowNote }] of Object.entries(icons)){
          const m = measure(img, 0, 0, img.width, img.height);
          const k = H / img.height;
          iconOut[name] = {
            nativeW: img.width, nativeH: img.height, nativeOpaquePx: m.opaquePx,
            bboxW: m.bboxW, bboxH: m.bboxH,
            H, k, apparentArea: k * k * m.opaquePx,
            footprintArea: k * k * m.bboxW * m.bboxH,
            apparentHeight: k * m.bboxH, apparentWidth: k * m.bboxW,
            glowR, glowNote,
          };
        }

        const letterOut = [];
        for (let i = 0; i < 8; i++){
          const img = IMG["lt" + (i + 1)];
          const m = measure(img, WORD_SRC.x[i], WORD_SRC.y, WORD_SRC.w[i], WORD_SRC.h);
          const k = LETTER_H / WORD_SRC.h;
          letterOut.push({
            key: "lt" + (i + 1), nativeCanvasW: img.width, nativeCanvasH: img.height,
            cropW: WORD_SRC.w[i], cropH: WORD_SRC.h, opaquePx: m.opaquePx,
            bboxW: m.bboxW, bboxH: m.bboxH,
            H: LETTER_H, k, apparentArea: k * k * m.opaquePx,
            footprintArea: k * k * m.bboxW * m.bboxH,
            apparentHeight: k * m.bboxH, apparentWidth: k * m.bboxW,
            glowR: SUN_R, glowNote: "letterSun fan, 1.0-1.14x flare (transient)",
          });
        }
        return { icons: iconOut, letters: letterOut };
      })()
    `, { awaitPromise: true });

    // footprintArea (apparent bounding-box W x H) is the metric that fairly
    // compares a sparse glyph against a solid-filled badge icon: opaque PIXEL
    // COUNT conflates "how big does this look" with "how dense/thin is this
    // shape's own linework", which is exactly why lt4 ("M") shows a +33%
    // opaquePx deviation among letters below despite being the same cap
    // height as every other letter in WORD_SRC's shared band -- M just has
    // more ink, not a bigger bounding box. footprintArea has no such bias.
    const letterFoot = result.letters.map(l => l.footprintArea);
    const letterFootMean = letterFoot.reduce((a, b) => a + b, 0) / letterFoot.length;
    const groupFootMean = (
      Object.values(result.icons).reduce((a, r) => a + r.footprintArea, 0) + letterFootMean
    ) / (Object.keys(result.icons).length + 1);   // letters counted once, as a group

    console.log("=== ICONS ===");
    for (const [name, r] of Object.entries(result.icons)){
      const devFoot = (r.footprintArea - groupFootMean) / groupFootMean;
      const devArea = (r.apparentArea - groupFootMean) / groupFootMean;   // for reference only, different metric
      console.log(
        name.padEnd(11) +
        " native=" + (r.nativeW + "x" + r.nativeH).padEnd(9) +
        " bbox=" + (r.bboxW + "x" + r.bboxH).padEnd(9) +
        " H=" + r.H.toFixed(2) +
        " apparentH=" + r.apparentHeight.toFixed(4) +
        " apparentW=" + r.apparentWidth.toFixed(4) +
        " footprintArea=" + r.footprintArea.toFixed(6) +
        " devFootprint=" + (devFoot >= 0 ? "+" : "") + (devFoot * 100).toFixed(1) + "%" +
        "  [opaqueArea=" + r.apparentArea.toFixed(4) + " devOpaqueArea=" + (devArea >= 0 ? "+" : "") + (devArea * 100).toFixed(1) + "%]" +
        " glowR=" + (r.glowR === null ? "n/a" : r.glowR) +
        "  (" + r.glowNote + ")"
      );
    }

    console.log("\n=== LETTERS (as a group; per-letter footprint) ===");
    for (const l of result.letters){
      const dev = (l.footprintArea - letterFootMean) / letterFootMean;
      const devArea = (l.apparentArea - (result.letters.reduce((a,x)=>a+x.apparentArea,0)/result.letters.length)) / (result.letters.reduce((a,x)=>a+x.apparentArea,0)/result.letters.length);
      console.log(
        l.key.padEnd(6) +
        " crop=" + (l.cropW + "x" + l.cropH).padEnd(9) +
        " bbox=" + (l.bboxW + "x" + l.bboxH).padEnd(9) +
        " apparentH=" + l.apparentHeight.toFixed(4) +
        " apparentW=" + l.apparentWidth.toFixed(4) +
        " footprintArea=" + l.footprintArea.toFixed(6) +
        " devWithinLetters=" + (dev >= 0 ? "+" : "") + (dev * 100).toFixed(1) + "%" +
        "  [devOpaqueArea=" + (devArea >= 0 ? "+" : "") + (devArea * 100).toFixed(1) + "%]"
      );
    }
    console.log("letters group mean footprintArea = " + letterFootMean.toFixed(6));
    console.log("\noverall group mean (5 icons + letters-as-one-group) footprintArea = " + groupFootMean.toFixed(6));

    console.log(JSON.stringify(result, null, 2));
  } finally {
    try { chrome.child.kill(); } catch (e) {}
  }
}

main().catch(e => { console.error(e); process.exit(1); });
