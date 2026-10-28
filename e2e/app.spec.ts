import { ENVIRONMENTS, expect, MOCK, test, withEnvironments } from "./fixtures";

test("adds an environment through the form and checks its token", async ({ app }) => {
  await app.goto("/");
  await expect(app.getByText("No environments yet")).toBeVisible();
  await app.getByRole("button", { name: "Add environment" }).click();
  await app.getByLabel("Environment URL or tenant ID").fill(`${MOCK}/production`);
  await app.getByLabel("Name").fill("Production");
  await app.getByLabel("API token").fill("dt0c01.MOCK.production");
  await app.getByRole("button", { name: "Add and test" }).click();
  await expect(app.getByText("Connected")).toBeVisible();
  await expect(app.getByText(/token “dmm”/)).toBeVisible();
});

test("rejects a bad token with a sentence, not a stack trace", async ({ app }) => {
  await withEnvironments(app, [{ id: "bad", name: "Broken", url: `${MOCK}/production`, token: "dt0c01.WRONG" }]);
  await app.goto("/#/environments");
  await app.getByRole("button", { name: "Test" }).click();
  await expect(app.getByText(/token was rejected \(401\)/)).toBeVisible();
});

test("overview sums every environment", async ({ app }) => {
  await withEnvironments(app);
  await app.goto("/");
  await expect(app.getByRole("heading", { name: "All environments" })).toBeVisible();
  const hosts = app.locator(".tile", { hasText: /^Hosts/ }).locator(".value");
  await expect(hosts).toHaveText("38");
  await expect(app.locator("tbody tr")).toHaveCount(3);
});

test("disables monitoring on a filtered set of hosts in one batch", async ({ app }) => {
  await withEnvironments(app);
  await app.goto("/#/hosts");
  await expect(app.locator("tbody tr")).toHaveCount(24);
  const disabledBefore = Number(await app.locator(".tile", { hasText: "Monitoring disabled" }).locator(".value").textContent());
  await app.getByPlaceholder("Filter…").fill("payments");
  await app.getByLabel("Select all").check();
  await app.getByRole("button", { name: "Disable monitoring" }).click();
  await app.getByRole("dialog").getByRole("button", { name: "Disable" }).click();
  await expect(app.getByText(/Monitoring disabled on \d+ host/)).toBeVisible();
  await app.getByPlaceholder("Filter…").fill("");
  await expect(async () => {
    const after = Number(await app.locator(".tile", { hasText: "Monitoring disabled" }).locator(".value").textContent());
    expect(after).toBeGreaterThan(disabledBefore);
  }).toPass();
});

test("copies auto-tag rules to other environments and skips existing ones", async ({ app }) => {
  await withEnvironments(app);
  await app.goto("/#/settings?schema=builtin:tags.auto-tagging");
  await expect(app.getByText("Owner from host group")).toBeVisible();
  await app.getByLabel("Select all").check();
  await app.getByRole("button", { name: "Copy to environments…" }).click();
  const dialog = app.getByRole("dialog");
  await dialog.getByLabel("Development").check();
  await dialog.getByRole("button", { name: /Copy to 1 environment/ }).click();
  // Development already has rules with the same names, so all three are skipped, none duplicated.
  await expect(dialog.getByText(/Development: 0 created, 3 skipped/)).toBeVisible();
  await dialog.getByLabel("Skip objects whose name already exists in the target").uncheck();
  await dialog.getByRole("button", { name: /Copy to 1 environment/ }).click();
  await expect(dialog.getByText(/Development: 3 created, 0 skipped/)).toBeVisible();
});

test("charts a metric query", async ({ app }) => {
  await withEnvironments(app);
  await app.goto("/#/metrics");
  await app.getByRole("button", { name: "Query" }).click();
  await expect(app.getByRole("img", { name: "Metric chart" })).toBeVisible();
  await expect(app.getByText(/6 series · resolution 15m/)).toBeVisible();
});

test("remembers environments encrypted and asks for the passphrase", async ({ app, context }) => {
  await withEnvironments(app);
  await app.goto("/#/environments");
  await app.getByRole("button", { name: "Remember on this device…" }).click();
  await app.getByLabel("Passphrase (8 characters or more)").fill("correct horse");
  await app.getByLabel("Repeat it").fill("correct horse");
  await app.getByRole("button", { name: "Remember", exact: true }).click();
  await expect(app.getByText("Remembered on this device", { exact: false }).first()).toBeVisible();
  const stored = await app.evaluate(() => localStorage.getItem("dmm.vault") ?? "");
  expect(stored).toContain("AES-GCM");
  expect(stored).not.toContain("MOCK");

  const fresh = await context.newPage();
  await fresh.goto("/");
  await fresh.getByLabel("Passphrase").fill("wrong passphrase");
  await fresh.getByRole("button", { name: "Open" }).click();
  await expect(fresh.getByText("Wrong passphrase.")).toBeVisible();
  await fresh.getByLabel("Passphrase").fill("correct horse");
  await fresh.getByRole("button", { name: "Open" }).click();
  await expect(fresh.getByRole("combobox", { name: "Environment" })).toHaveValue(ENVIRONMENTS[0]!.id);
});

const PAGES: [string, string][] = [
  ["/hosts", "Hosts"], ["/activegates", "ActiveGates"], ["/network-zones", "Network zones"], ["/synthetic", "Synthetic monitors"],
  ["/problems", "Problems"], ["/events", "Events"], ["/metrics", "Metric explorer"], ["/logs", "Log search"], ["/slos", "SLOs"],
  ["/releases", "Releases"], ["/settings", "Auto-tag rules"], ["/entities", "Entities & tags"], ["/dashboards", "Dashboards (classic)"],
  ["/request-naming", "Request naming"], ["/extensions", "Extensions"], ["/vulnerabilities", "Vulnerabilities"], ["/tokens", "API tokens"], ["/audit", "Audit log"],
];

for (const [path, title] of PAGES) {
  test(`page ${path} loads its data without an error`, async ({ app }) => {
    await withEnvironments(app);
    await app.goto(`/#${path}`);
    await expect(app.locator("main h1")).toHaveText(title);
    await expect(app.locator(".loading")).toHaveCount(0);
    await expect(app.locator(".error-box")).toHaveCount(0);
  });
}

test("sample data works with no Dynatrace and no network", async ({ app }) => {
  await app.route(/^(?!http:\/\/localhost:4173)/, (route) => route.abort());
  await app.goto("/");
  await app.getByRole("button", { name: "Try it with sample data" }).click();
  await expect(app.locator(".tile", { hasText: /^Hosts/ }).locator(".value")).toHaveText("38");
  await app.getByRole("link", { name: "Hosts" }).click();
  await expect(app.locator("tbody tr")).toHaveCount(24);
});
