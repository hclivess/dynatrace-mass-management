import { test as base, expect, type Page } from "@playwright/test";

export const MOCK = "http://localhost:8787/e";

export const ENVIRONMENTS = [
  { id: "env-prod", name: "Production", url: `${MOCK}/production`, token: "dt0c01.MOCK.production" },
  { id: "env-stage", name: "Staging", url: `${MOCK}/staging`, token: "dt0c01.MOCK.staging" },
  { id: "env-dev", name: "Development", url: `${MOCK}/development`, token: "dt0s16.MOCK.development" },
];

/** Any uncaught exception or console error fails the test: "the page opened" is not a pass. */
export const test = base.extend<{ app: Page }>({
  app: async ({ page }, use) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text());
    });
    await use(page);
    expect(errors, "browser errors").toEqual([]);
  },
});

export async function withEnvironments(page: Page, envs = ENVIRONMENTS): Promise<void> {
  await page.addInitScript((list) => {
    if (!sessionStorage.getItem("dmm.session")) sessionStorage.setItem("dmm.session", JSON.stringify(list));
  }, envs);
}

export { expect };
