#!/usr/bin/env node
// Small, safe capacity check for the leaderboard REST routes — deliberately
// conservative so it reads as organic traffic rather than a flood pattern
// and doesn't risk tripping Kinsta's abuse detection or the app's own
// per-IP rate limiter (class-rate-limiter.php: 20/5min on /submit, 30/10min
// on /claim). Staging only — hard-blocked from production, no override.
//
//   node tools/load-test.js [--levels=5,10,20] [--duration=15] [--include-writes]
//
// Only hits the zero-rate-limit read routes (/leaderboard, /rank, /names)
// by default. --include-writes adds a light, throttled trickle of
// /claim + /submit (well under the existing per-IP thresholds) to confirm
// the write path still behaves correctly under concurrent read load — not
// to find its ceiling.

const BASE = process.env.STAMPEDE_STAGING_URL || "https://env-typhoontexasnew-dev.kinsta.cloud";
const API = `${BASE}/wp-json/waterpark-leaderboard/v1`;

if (BASE.includes("typhoontexas.com")) {
  console.error("Refusing to run: this tool is staging-only and typhoontexas.com looks like production.");
  process.exit(1);
}

function parseArgs() {
  const args = { levels: [5, 10, 20], duration: 15, includeWrites: false };
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--levels=")) args.levels = arg.slice(9).split(",").map(Number);
    else if (arg.startsWith("--duration=")) args.duration = Number(arg.slice(11));
    else if (arg === "--include-writes") args.includeWrites = true;
  }
  return args;
}

function pickReadRoute() {
  // Weighted toward /leaderboard — this mirrors real post-run traffic
  // (everyone checking the board), not synthetic uniform load.
  const r = Math.random();
  if (r < 0.6) return { method: "GET", path: `/leaderboard` };
  if (r < 0.85) return { method: "GET", path: `/rank?name=${encodeURIComponent(sampleName())}` };
  return { method: "GET", path: `/names` };
}

const SAMPLE_NAMES = ["Buckaroo Wave", "Slippery Steer", "Rowdy Splash", "Yippee Tide"];
function sampleName() {
  return SAMPLE_NAMES[Math.floor(Math.random() * SAMPLE_NAMES.length)];
}

// Runs independently of the read ramp at a fixed, low rate — well under the
// app's own per-IP thresholds (20/5min submit, 30/10min claim) — to confirm
// the write path still behaves correctly alongside concurrent read load.
// Not a capacity probe: the rate limiter would just mask a higher one.
function startWriteTrickle() {
  const writes = [];
  let stopped = false;
  const timer = setInterval(async () => {
    if (stopped) return;
    const name = `LoadTest ${sampleName()} ${Date.now()}`;
    const claimRes = await timedRequest({ method: "POST", path: "/claim", body: { name } });
    writes.push({ route: "/claim", ...claimRes });
    if (claimRes.ok) {
      const submitRes = await timedRequest({ method: "POST", path: "/submit", body: { name, score: 500 } });
      writes.push({ route: "/submit", ...submitRes });
    }
  }, 20000); // one claim+submit pair every 20s — nowhere near either threshold
  return { writes, stop: () => { stopped = true; clearInterval(timer); } };
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

async function timedRequest(route) {
  const started = Date.now();
  try {
    const res = await fetch(`${API}${route.path}`, {
      method: route.method,
      ...(route.body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(route.body) } : {}),
    });
    await res.arrayBuffer(); // drain body so the connection is actually freed
    return { ok: res.ok, status: res.status, ms: Date.now() - started };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - started, error: e.message };
  }
}

async function runLevel(concurrency, durationSec) {
  const deadline = Date.now() + durationSec * 1000;
  const results = [];
  let consecutiveFailures = 0;
  let aborted = false;

  async function worker() {
    while (Date.now() < deadline && !aborted) {
      const r = await timedRequest(pickReadRoute());
      results.push(r);
      if (!r.ok) {
        consecutiveFailures++;
        if (consecutiveFailures >= 3) {
          aborted = true;
          break;
        }
      } else {
        consecutiveFailures = 0;
      }
      await new Promise(res => setTimeout(res, 50 + Math.random() * 200)); // jitter
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return { results, aborted };
}

function summarize(concurrency, results, aborted) {
  const durations = results.map(r => r.ms).sort((a, b) => a - b);
  const byStatus = {};
  for (const r of results) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  const errorCount = results.filter(r => !r.ok).length;

  console.log(`\n== concurrency=${concurrency} ==`);
  console.log(`  requests: ${results.length}  errors: ${errorCount}  aborted-early: ${aborted}`);
  console.log(`  status breakdown: ${JSON.stringify(byStatus)}`);
  console.log(`  latency ms — p50=${percentile(durations, 0.5)} p95=${percentile(durations, 0.95)} p99=${percentile(durations, 0.99)}`);

  return { concurrency, requests: results.length, errorCount, aborted };
}

async function main() {
  const { levels, duration, includeWrites } = parseArgs();
  console.log(`Load test against ${API}`);
  console.log(`Levels: ${levels.join(", ")} concurrent, ${duration}s each${includeWrites ? " (writes included)" : " (reads only)"}`);

  const trickle = includeWrites ? startWriteTrickle() : null;

  const summary = [];
  for (const concurrency of levels) {
    const { results, aborted } = await runLevel(concurrency, duration);
    summary.push(summarize(concurrency, results, aborted));
    if (aborted) {
      console.error(`\nAborted at concurrency=${concurrency} after 3 consecutive failures — stopping the ramp.`);
      break;
    }
    await new Promise(res => setTimeout(res, 2000)); // cool-down between levels
  }

  if (trickle) {
    trickle.stop();
    const writeErrors = trickle.writes.filter(w => !w.ok).length;
    console.log(`\n== Write trickle (/claim + /submit, 1 pair/20s) ==`);
    console.log(`  requests: ${trickle.writes.length}  errors: ${writeErrors}`);
    console.log(JSON.stringify(trickle.writes, null, 2));
  }

  console.log("\n== Summary ==");
  console.log(JSON.stringify(summary, null, 2));

  if (summary.some(s => s.aborted || s.errorCount > 0) || (trickle && trickle.writes.some(w => !w.ok))) {
    process.exitCode = 1;
  }
}

main().catch(e => { console.error(e); process.exit(1); });
