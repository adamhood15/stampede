#!/usr/bin/env node
// Sprite animation audit (see TODOLIST.md "Sprite animation audit"): checks
// whether every registered rider-animation frame set renders Typhoon at a
// CONSISTENT VISUAL SIZE frame to frame -- not consistent PNG pixel
// dimensions, which is a red herring (the season-pass frames alone range
// from 436x481 to 560x517 and that is fine on its own).
//
// The real invariant is what drawRider() actually puts on screen. For a
// tube-registered set (DUCK_REG/HURT_REG/DIE_REG/EAT_REG/SEASONPASS_REG/
// MOVE_REG) that is:
//   dw = (w * RIDER_TUBE_W) / R.tw;  k = dw / img.width
// dw/img.width == dh/img.height always (drawImage never distorts aspect),
// so k is a single uniform per-frame scale factor. Multiplying it by that
// frame's own opaque (non-transparent) pixel COUNT -- not its bounding box,
// which foreshortening/cropping can shrink or grow independent of the
// character's actual size -- gives the character's real on-screen silhouette
// area. That is the number that should hold flat across a set; if it does
// not, Typhoon visibly grows or shrinks between frames even though every
// registration constant in the code is individually "correct" by its own
// tube/area measurement.
//
// For an area-registered set (FLIP_REG/SPIN_REG/SPEED_REG) the scale factor
// is k = (h / img.height) * R.s, chosen by construction so apparent area
// should already come out flat -- this audit is what proves that, rather
// than assuming the comment claiming it is true.
//
// node tools/sprite-size-audit.js
// node tools/sprite-size-audit.js --threshold 0.06   (flag >6% deviation)

const { launchChrome, openPage, evaluate, VIEWPORTS } = require("./cdp");

const SERVER = process.env.STAMPEDE_URL || "http://127.0.0.1:8000/index.html";
const thresholdArg = process.argv.indexOf("--threshold");
const THRESHOLD = thresholdArg >= 0 ? parseFloat(process.argv[thresholdArg + 1]) : 0.08;

async function main() {
  const chrome = await launchChrome({});
  try {
    const { session } = await openPage({ port: chrome.port, url: SERVER, viewport: VIEWPORTS.phone412 });
    await new Promise(r => setTimeout(r, 400));

    const result = await evaluate(session, `
      (async () => {
        function opaqueArea(img){
          const c = document.createElement("canvas");
          c.width = img.width; c.height = img.height;
          const cx = c.getContext("2d");
          cx.drawImage(img, 0, 0);
          const data = cx.getImageData(0, 0, img.width, img.height).data;
          let n = 0;
          for (let i = 3; i < data.length; i += 4) if (data[i] >= 16) n++;
          return n;
        }

        const h = 1, w = h * (IMG.rider.width / IMG.rider.height);

        const tubeSets = {
          DUCK_REG:       { reg: DUCK_REG,       keys: ["duck0","duck1","duck2"] },
          HURT_REG:       { reg: HURT_REG,       keys: ["hurt0","hurt1","hurt2"] },
          DIE_REG:        { reg: DIE_REG,        keys: ["die0","die1","die2"] },
          EAT_REG:        { reg: EAT_REG,        keys: ["eat0","eat1","eat2","eat3"] },
          SEASONPASS_REG: { reg: SEASONPASS_REG, keys: ["sp0","sp1","sp2","sp3","sp4","sp5","sp6","sp7","sp8"] },
          MOVE_REG:       { reg: [MOVE_REG["-1"], MOVE_REG["1"]], keys: ["mvL","mvR"] },
        };
        const areaSets = {
          FLIP_REG:  { reg: FLIP_REG,  keys: ["flip0","flip1","flip2","flip3"] },
          SPIN_REG:  { reg: SPIN_REG,  keys: ["spin0","spin1","spin2","spin3"] },
          SPEED_REG: { reg: SPEED_REG, keys: ["speed0","speed1","speed2","speed3"] },
        };

        const out = {};
        for (const [name, { reg, keys }] of Object.entries(tubeSets)){
          out[name] = keys.map((key, i) => {
            const img = IMG[key], R = reg[i];
            const dw = (w * RIDER_TUBE_W) / R.tw;
            const k = dw / img.width;
            const area = opaqueArea(img);
            return { key, nativeW: img.width, nativeH: img.height, nativeOpaquePx: area,
                      k, apparentArea: k * k * area, tw: R.tw };
          });
        }
        for (const [name, { reg, keys }] of Object.entries(areaSets)){
          out[name] = keys.map((key, i) => {
            const img = IMG[key], R = reg[i];
            const k = (h / img.height) * R.s;
            const area = opaqueArea(img);
            return { key, nativeW: img.width, nativeH: img.height, nativeOpaquePx: area,
                      k, apparentArea: k * k * area, s: R.s };
          });
        }
        return out;
      })()
    `, { awaitPromise: true });

    const report = {};
    let anyFlag = false;
    for (const [setName, frames] of Object.entries(result)){
      const areas = frames.map(f => f.apparentArea);
      const mean = areas.reduce((a, b) => a + b, 0) / areas.length;
      const rows = frames.map((f, i) => {
        const dev = (f.apparentArea - mean) / mean;
        const prev = i > 0 ? frames[i - 1].apparentArea : null;
        const stepPct = prev !== null ? (f.apparentArea - prev) / prev : null;
        return { ...f, devFromMean: dev, stepFromPrev: stepPct };
      });
      const flagged = rows.filter(r => Math.abs(r.devFromMean) > THRESHOLD);
      if (flagged.length) anyFlag = true;
      report[setName] = { mean, rows, flagged: flagged.map(r => r.key) };
    }

    console.log(JSON.stringify(report, null, 2));
    console.log(anyFlag
      ? "\nFLAGGED (>±" + (THRESHOLD * 100).toFixed(0) + "% of set mean apparent area): " +
        Object.entries(report).filter(([, r]) => r.flagged.length)
          .map(([n, r]) => n + ": " + r.flagged.join(", ")).join(" | ")
      : "\nNo frame set deviates beyond threshold.");
    process.exit(anyFlag ? 1 : 0);
  } finally {
    try { chrome.child.kill(); } catch (e) {}
  }
}

main().catch(e => { console.error(e); process.exit(1); });
