// Read-only smoke test against a real tenant: opens every page of the built site, reports load time,
// row count and any error, and saves a screenshot per page. Every write request is blocked.
//
//   npm run build
//   DT_URL=wkf10640 DT_TOKEN=dt0c01.… node scripts/smoke-live.mjs [screenshot-dir]
import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
const OUT = process.argv[2] ?? "docs/shots";
mkdirSync(OUT, { recursive: true });
if (!process.env.DT_URL || !process.env.DT_TOKEN) throw new Error("Set DT_URL and DT_TOKEN.");
const env = [{ id: "live", name: process.env.DT_NAME ?? process.env.DT_URL, url: process.env.DT_URL, token: process.env.DT_TOKEN }];
const preview = spawn("npx", ["vite", "preview", "--port", "4173", "--strictPort"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 1 });
await ctx.addInitScript((l) => sessionStorage.setItem("dmm.session", JSON.stringify(l)), env);
// Belt and braces: the probe may only read.
await ctx.route(/^https:/, (route) => {
  const m = route.request().method();
  const u = route.request().url();
  if (m === "GET" || (m === "POST" && u.includes("/apiTokens/lookup"))) return route.continue();
  console.log("BLOCKED", m, u);
  return route.abort();
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
for (const path of ["/", "/hosts", "/activegates", "/network-zones", "/synthetic", "/problems", "/events", "/metrics", "/logs", "/slos", "/releases", "/settings", "/entities", "/dashboards", "/request-naming", "/extensions", "/vulnerabilities", "/tokens", "/audit"]) {
  const t0 = Date.now();
  await page.goto(`http://localhost:4173/#${path}`);
  if (path === "/metrics") await page.getByRole("button", { name: "Query" }).click();
  await page.waitForFunction(() => !document.querySelector(".loading") && ![...document.querySelectorAll("td .muted")].some((e) => e.textContent === "…"), null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(500);
  const err = await page.locator(".error-box").allTextContents();
  const rows = await page.locator("tbody tr").count();
  console.log(`${path.padEnd(16)} ${String(Date.now() - t0).padStart(6)}ms rows=${rows} ${err.length ? "ERROR: " + err.join(" | ").slice(0, 160) : ""}`);
  await page.screenshot({ path: `${OUT}/${path === "/" ? "overview" : path.slice(1)}.png` });
}
console.log("pageerrors:", errors);
await browser.close();
preview.kill();
