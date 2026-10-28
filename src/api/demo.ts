import type { Environment } from "../store/vault";

/**
 * "Try it with sample data": three invented environments answered by the same mock the
 * self-test uses, running inside the page. Nothing is sent anywhere.
 */
export const DEMO_ROOT = "https://demo.invalid";

export function demoEnvironments(): Environment[] {
  return [
    { id: "demo-production", name: "Production (sample)", url: `${DEMO_ROOT}/e/production`, token: "dt0c01.MOCK.sample" },
    { id: "demo-staging", name: "Staging (sample)", url: `${DEMO_ROOT}/e/staging`, token: "dt0c01.MOCK.sample" },
    { id: "demo-development", name: "Development (sample)", url: `${DEMO_ROOT}/e/development`, token: "dt0s16.MOCK.sample" },
  ];
}

/**
 * The live Dynatrace Playground (wkf10640), with a read-only token baked into the hosted build
 * only. Dynatrace wipes the Playground now and then, which kills the token; callers fall back to
 * the sample data then.
 */
const PLAYGROUND_TOKEN = import.meta.env.VITE_PLAYGROUND_TOKEN?.trim();

export function playgroundEnvironment(): Environment | null {
  if (!PLAYGROUND_TOKEN) return null;
  return { id: "playground", name: "Dynatrace Playground", url: "wkf10640", token: PLAYGROUND_TOKEN, readOnly: true };
}

export function isDemo(apiRoot: string): boolean {
  return apiRoot.startsWith(DEMO_ROOT);
}

let handler: Promise<ReturnType<typeof import("../../mock/dynatrace.mjs").createMock>> | null = null;

/** A fetch that answers from the in-page mock; loaded on first use so real users never download it. */
export const demoFetch: typeof fetch = async (input, init) => {
  handler ??= import("../../mock/dynatrace.mjs").then((m) => m.createMock());
  const handle = await handler;
  const url = new URL(String(input));
  const headers = new Headers(init?.headers);
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
  // A little latency so loading states are visible, as with a real tenant.
  await new Promise((r) => setTimeout(r, 120 + Math.random() * 180));
  const result = handle(init?.method ?? "GET", url.pathname + url.search, headers.get("Authorization") ?? undefined, body);
  return new Response(result.body === undefined ? null : JSON.stringify(result.body), {
    status: result.status,
    headers: { "Content-Type": "application/json" },
  });
};
