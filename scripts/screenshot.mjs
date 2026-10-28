// Captures docs/thumb.png and docs/demo.gif from a real run of the built site against the mock
// Dynatrace (invented data). Needs `npm run build`, then: node scripts/screenshot.mjs
//   --only-shots  writes docs/shots/*.png for every page instead (for reviewing the layout)

import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { chromium } from "@playwright/test";

const MOCK = "http://localhost:8787/e";
const SITE = "http://localhost:4173";
const ENVIRONMENTS = [
  { id: "env-prod", name: "Production", url: `${MOCK}/production`, token: "dt0c01.MOCK.production" },
  { id: "env-stage", name: "Staging", url: `${MOCK}/staging`, token: "dt0c01.MOCK.staging" },
  { id: "env-dev", name: "Development", url: `${MOCK}/development`, token: "dt0c01.MOCK.development" },
];
const onlyShots = process.argv.includes("--only-shots");
const scheme = process.argv.includes("--dark") ? "dark" : "light";

const servers = [
  spawn("node", ["mock/server.mjs", "8787"], { stdio: "ignore" }),
  spawn("npx", ["vite", "preview", "--port", "4173", "--strictPort"], { stdio: "ignore" }),
];
const stop = () => servers.forEach((s) => s.kill());
process.on("exit", stop);

async function waitFor(url) {
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error(`${url} did not start`);
}
await waitFor(SITE);
await waitFor(`${MOCK}/production/api/v2/metrics`);

const browser = await chromium.launch();
const size = { width: 1280, height: 760 };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function newContext(video) {
  const context = await browser.newContext({ viewport: size, colorScheme: scheme, deviceScaleFactor: video ? 1 : 2, ...(video ? { recordVideo: { dir: "docs/.video", size } } : {}) });
  await context.addInitScript((list) => {
    if (!sessionStorage.getItem("dmm.session")) sessionStorage.setItem("dmm.session", JSON.stringify(list));
  }, ENVIRONMENTS);
  return context;
}

mkdirSync("docs", { recursive: true });

if (onlyShots) {
  mkdirSync("docs/shots", { recursive: true });
  const context = await newContext(false);
  const page = await context.newPage();
  for (const path of ["/", "/environments", "/hosts", "/activegates", "/network-zones", "/synthetic", "/problems", "/events", "/metrics", "/logs", "/slos", "/releases", "/settings", "/entities", "/dashboards", "/request-naming", "/extensions", "/vulnerabilities", "/tokens", "/audit"]) {
    await page.goto(`${SITE}/#${path}`);
    await page.waitForLoadState("networkidle");
    if (path === "/metrics") await page.getByRole("button", { name: "Query" }).click();
    if (path === "/logs") await page.getByRole("button", { name: "Search" }).click();
    await pause(400);
    await page.screenshot({ path: `docs/shots/${path === "/" ? "overview" : path.slice(1)}-${scheme}.png` });
  }
  await context.close();
} else {
  // Thumbnail: the hosts page mid bulk action, the thing DMM is for.
  {
    const context = await newContext(false);
    const page = await context.newPage();
    await page.goto(`${SITE}/#/hosts`);
    await page.waitForLoadState("networkidle");
    await page.getByPlaceholder("Filter…").fill("payments");
    await page.getByLabel("Select all").check();
    await pause(300);
    await page.screenshot({ path: "docs/thumb.png" });
    await context.close();
  }

  // Demo: overview → hosts bulk disable → copy auto-tags to other environments → metric chart.
  {
    rmSync("docs/.video", { recursive: true, force: true });
    const context = await newContext(true);
    const page = await context.newPage();
    const slowType = async (locator, text) => { await locator.click(); await locator.pressSequentially(text, { delay: 60 }); };
    await page.goto(`${SITE}/#/`);
    await page.waitForLoadState("networkidle");
    await pause(1800);
    await page.getByRole("link", { name: "Hosts" }).click();
    await page.waitForLoadState("networkidle");
    await pause(900);
    await slowType(page.getByPlaceholder("Filter…"), "payments");
    await pause(500);
    await page.getByLabel("Select all").check();
    await pause(800);
    await page.getByRole("button", { name: "Disable monitoring" }).click();
    await pause(1100);
    await page.getByRole("dialog").getByRole("button", { name: "Disable" }).click();
    await pause(1600);
    await page.getByRole("link", { name: "Settings 2.0" }).click();
    await page.waitForLoadState("networkidle");
    await pause(900);
    await page.getByLabel("Select all").check();
    await pause(500);
    await page.getByRole("button", { name: "Copy to environments…" }).click();
    await pause(700);
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Staging").check();
    await dialog.getByLabel("Development").check();
    await dialog.getByLabel("Skip objects whose name already exists in the target").uncheck();
    await pause(600);
    await dialog.getByRole("button", { name: /Copy to 2 environment/ }).click();
    await pause(2000);
    await dialog.getByRole("button", { name: "Close", exact: true }).last().click();
    await page.getByRole("link", { name: "Metric explorer" }).click();
    await page.waitForLoadState("networkidle");
    await pause(500);
    await page.getByRole("button", { name: "Query" }).click();
    await pause(2600);
    await context.close();
    const [video] = readdirSync("docs/.video");
    renameSync(`docs/.video/${video}`, "docs/.video/demo.webm");
    // Two-pass palette keeps the GIF sharp and small.
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", "docs/.video/demo.webm", "-vf", "fps=10,scale=960:-1:flags=lanczos,palettegen=max_colors=96:stats_mode=diff", "docs/.video/palette.png"]);
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", "docs/.video/demo.webm", "-i", "docs/.video/palette.png", "-lavfi", "fps=10,scale=960:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle", "docs/demo.gif"]);
    rmSync("docs/.video", { recursive: true, force: true });
  }
}

await browser.close();
stop();
console.log(onlyShots ? "docs/shots written" : "docs/thumb.png and docs/demo.gif written");
