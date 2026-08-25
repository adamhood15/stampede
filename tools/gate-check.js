#!/usr/bin/env node
// Verifies the WP-hosted gate + blank-template route deployed by
// tools/deploy-staging.sh (see ARCHITECTURE.md#tooling for the CDP
// conventions this follows).
//
//   STAMPEDE_STAGING_URL=https://env-typhoontexasnew-dev.kinsta.cloud \
//     node tools/gate-check.js [viewport]
//
// Checks:
//   1. /play/ with no token redirects away (doesn't serve the game).
//   2. A token from /gate-token lets /play/?t=... actually boot the game.
//   3. No theme/plugin chrome (nav/header/footer, extra stylesheets) leaked
//      into the blank-template response.
//   4. Screenshots the booted game at a phone viewport.

const fs = require("node:fs");
const path = require("node:path");
const { launchChrome, openPage, evaluate, VIEWPORTS } = require("./cdp");

const BASE = process.env.STAMPEDE_STAGING_URL || "https://env-typhoontexasnew-dev.kinsta.cloud";

async function main() {
  const viewportName = process.argv[2] && VIEWPORTS[process.argv[2]] ? process.argv[2] : "phone412";
  const viewport = VIEWPORTS[viewportName];

  console.log("== Fetching gate token ==");
  const tokenRes = await fetch(`${BASE}/wp-json/waterpark-leaderboard/v1/gate-token`);
  const { token } = await tokenRes.json();
  if (!token) throw new Error("No token returned from /gate-token");
  console.log("  token:", token);

  const chrome = await launchChrome({});
  try {
    console.log("== Loading /play/ with no token (expect redirect away) ==");
    const noToken = await openPage({ port: chrome.port, url: `${BASE}/play/`, viewport });
    const noTokenUrl = await evaluate(noToken.session, "location.href");
    if (noTokenUrl.includes("/play/")) {
      throw new Error(`Gate did not redirect an unauthenticated /play/ request — landed on ${noTokenUrl}`);
    }
    console.log("  redirected to:", noTokenUrl, "(OK)");

    console.log("== Loading /play/?t=<token> (expect the game to boot) ==");
    const { session } = await openPage({ port: chrome.port, url: `${BASE}/play/?t=${token}`, viewport });

    const chromeCheck = await evaluate(session, `({
      hasStage: !!document.querySelector("#stage"),
      hasNav: !!document.querySelector("nav, header, footer, #wpadminbar"),
      styleSheetCount: document.styleSheets.length,
      title: document.title,
    })`);
    console.log("  page shape:", JSON.stringify(chromeCheck));
    if (!chromeCheck.hasStage) throw new Error("#stage not found — game did not render");
    if (chromeCheck.hasNav) throw new Error("Found nav/header/footer/admin-bar — theme chrome leaked into the blank template");

    await new Promise(r => setTimeout(r, 400)); // let the loader's asset fetch settle, per screenshot.js
    await evaluate(session, "dismissLoader(); afterLoader(); Board.claim('Test Rider'); start();");
    await new Promise(r => setTimeout(r, 600));

    const outPath = path.join(__dirname, `../.tmp-gate-check-${viewportName}.png`);
    const shot = await session.send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(outPath, Buffer.from(shot.data, "base64"));

    console.log(JSON.stringify({ ok: true, viewport: viewportName, screenshot: outPath }, null, 2));
  } finally {
    await new Promise((resolve) => {
      chrome.child.once("exit", resolve);
      chrome.child.kill();
    });
    fs.rmSync(chrome.userDataDir, { recursive: true, force: true, maxRetries: 3 });
  }
}

main().catch(e => { console.error(e); process.exit(1); });
