import { describe, expect, it, vi } from "vitest";
import { ApiError, Http, retryDelay } from "../src/api/http";

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

describe("Http", () => {
  it("sends the token and drops empty query values", async () => {
    const fetchMock = vi.fn(async () => json({ ok: true }));
    const http = new Http("https://t.live.dynatrace.com", "dt0c01.ABC", fetchMock as unknown as typeof fetch);
    await http.get("/api/v2/entities", { entitySelector: 'type("HOST")', fields: "", from: undefined });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://t.live.dynatrace.com/api/v2/entities?entitySelector=type%28%22HOST%22%29");
    expect((init.headers as Record<string, string>).Authorization).toBe("Api-Token dt0c01.ABC");
  });

  it("follows nextPageKey without repeating the original filters", async () => {
    const pages = [
      json({ totalCount: 3, nextPageKey: "k1", entities: [{ id: 1 }, { id: 2 }] }),
      json({ totalCount: 3, entities: [{ id: 3 }] }),
    ];
    const fetchMock = vi.fn(async () => pages.shift()!);
    const http = new Http("https://t.live.dynatrace.com", "x", fetchMock as unknown as typeof fetch);
    const page = await http.paginate("/api/v2/entities", "entities", { entitySelector: "type(HOST)", pageSize: 500 });
    expect(page.items).toHaveLength(3);
    expect(page.totalCount).toBe(3);
    const second = (fetchMock.mock.calls[1] as unknown as [string])[0];
    expect(second).toBe("https://t.live.dynatrace.com/api/v2/entities?nextPageKey=k1");
  });

  it("retries after a 429", async () => {
    const responses = [json({}, 429, { "Retry-After": "0.01" }), json({ done: true })];
    const fetchMock = vi.fn(async () => responses.shift()!);
    const http = new Http("https://t.live.dynatrace.com", "x", fetchMock as unknown as typeof fetch);
    await expect(http.get("/api/v2/problems")).resolves.toEqual({ done: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("explains constraint violations", async () => {
    const body = { error: { code: 400, message: "Validation failed", constraintViolations: [{ path: "name", message: "must not be empty" }] } };
    const http = new Http("https://t.live.dynatrace.com", "x", (async () => json(body, 400)) as unknown as typeof fetch);
    const error = await http.post("/api/v2/settings/objects", []).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toContain("name: must not be empty");
  });

  it("says what a 401 means", async () => {
    const http = new Http("https://t.live.dynatrace.com", "x", (async () => json({}, 401)) as unknown as typeof fetch);
    await expect(http.get("/api/v2/metrics")).rejects.toThrow(/token was rejected/);
  });

  it("turns a network failure into a sentence", async () => {
    const http = new Http("https://t.live.dynatrace.com", "x", (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch);
    await expect(http.get("/api/v2/metrics")).rejects.toThrow(/Cannot reach t.live.dynatrace.com/);
  });
});

describe("retryDelay", () => {
  it("prefers Retry-After, then X-RateLimit-Reset, then backs off", () => {
    expect(retryDelay({ headers: new Headers({ "Retry-After": "2" }) }, 0)).toBe(2000);
    const reset = (Date.now() + 5000) * 1000;
    const wait = retryDelay({ headers: new Headers({ "X-RateLimit-Reset": String(reset) }) }, 0);
    expect(wait).toBeGreaterThan(4000);
    expect(wait).toBeLessThanOrEqual(5000);
    expect(retryDelay({ headers: new Headers() }, 2)).toBe(4000);
  });
});

describe("read-only demo", () => {
  it("refuses every change before it leaves the browser, but still reads", async () => {
    const fetchMock = vi.fn(async () => json({ ok: true }));
    const http = new Http("https://t.live.dynatrace.com", "x", fetchMock as unknown as typeof fetch, true);
    await expect(http.post("/api/v2/settings/objects", [])).rejects.toThrow(/read-only demo/);
    await expect(http.delete("/api/v2/tags")).rejects.toThrow(/read-only demo/);
    await expect(http.put("/api/v2/networkZones/x", {})).rejects.toThrow(/read-only demo/);
    expect(fetchMock).not.toHaveBeenCalled();
    await http.get("/api/v2/entities");
    await http.post("/api/v2/apiTokens/lookup", { token: "x" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
