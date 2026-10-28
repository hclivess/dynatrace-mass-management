/**
 * The transport every API call goes through: one environment, one token, fetch with a timeout,
 * Dynatrace's rate-limit headers honoured, and errors turned into sentences a person can act on.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type Query = Record<string, string | number | boolean | undefined | null>;

export interface RequestOptions {
  query?: Query;
  body?: unknown;
  signal?: AbortSignal;
}

export interface Page<T> {
  items: T[];
  totalCount?: number;
}

const TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
/** Never let a runaway pagination loop download a whole tenant. */
export const MAX_PAGES = 200;

export class Http {
  constructor(
    readonly apiRoot: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  url(path: string, query?: Query): string {
    const url = new URL(this.apiRoot + path);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const url = this.url(path, options.query);
    for (let attempt = 0; ; attempt++) {
      const timeout = AbortSignal.timeout(TIMEOUT_MS);
      const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method,
          signal,
          headers: {
            Authorization: authorization(this.token),
            Accept: "application/json",
            ...(options.body === undefined ? {} : { "Content-Type": "application/json; charset=utf-8" }),
          },
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
        });
      } catch (error) {
        if (options.signal?.aborted) throw error;
        if (timeout.aborted) throw new ApiError(`No answer from ${new URL(url).host} within 30 s.`, 0);
        throw new ApiError(
          `Cannot reach ${new URL(url).host}. Check the URL, your network, and that the browser is not blocking the request.`,
          0,
        );
      }

      if (response.status === 429 && attempt < MAX_RETRIES) {
        await sleep(retryDelay(response, attempt), options.signal);
        continue;
      }
      return parse<T>(response, method, path);
    }
  }

  get<T>(path: string, query?: Query, signal?: AbortSignal): Promise<T> {
    return this.request<T>("GET", path, { query, signal });
  }

  post<T>(path: string, body?: unknown, query?: Query): Promise<T> {
    return this.request<T>("POST", path, { body, query });
  }

  put<T>(path: string, body?: unknown, query?: Query): Promise<T> {
    return this.request<T>("PUT", path, { body, query });
  }

  delete<T = void>(path: string, query?: Query): Promise<T> {
    return this.request<T>("DELETE", path, { query });
  }

  /**
   * Follows `nextPageKey`. Dynatrace rejects a follow-up request that repeats the original
   * filters, so every page after the first carries the key and nothing else.
   */
  async paginate<T>(path: string, itemsKey: string, query: Query = {}, signal?: AbortSignal, limit = Infinity): Promise<Page<T> & { truncated: boolean }> {
    const items: T[] = [];
    let page = await this.get<Record<string, unknown>>(path, query, signal);
    const totalCount = typeof page.totalCount === "number" ? page.totalCount : undefined;
    for (let n = 1; ; n++) {
      const chunk = page[itemsKey];
      if (Array.isArray(chunk)) items.push(...(chunk as T[]));
      const next = page.nextPageKey;
      if (typeof next !== "string" || !next || n >= MAX_PAGES) break;
      if (items.length >= limit) return { items: items.slice(0, limit), totalCount, truncated: true };
      page = await this.get<Record<string, unknown>>(path, { nextPageKey: next }, signal);
    }
    return { items, totalCount, truncated: false };
  }
}

/**
 * Classic access tokens (dt0c01.…) use the Api-Token scheme; platform tokens (dt0s16.…), which
 * Dynatrace is moving everyone to, are bearer tokens. The classic Environment API takes both.
 */
export function authorization(token: string): string {
  return isPlatformToken(token) ? `Bearer ${token}` : `Api-Token ${token}`;
}

export function isPlatformToken(token: string): boolean {
  return /^dt0s\d{2}\./.test(token.trim());
}

async function parse<T>(response: Response, method: string, path: string): Promise<T> {
  const text = await response.text();
  let body: unknown = undefined;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (response.ok) return body as T;
  throw new ApiError(describe(response.status, body, method, path), response.status, body);
}

export function describe(status: number, body: unknown, method: string, path: string): string {
  const detail = errorDetail(body);
  const what = `${method} ${path.split("?")[0]}`;
  switch (status) {
    case 401:
      return `The token was rejected (401). It may be expired, revoked, or for a different environment.${detail ? ` ${detail}` : ""}`;
    case 403:
      return `The token lacks a permission this needs (403, ${what}).${detail ? ` ${detail}` : ""}`;
    case 404:
      return `Not found (404, ${what}).${detail ? ` ${detail}` : ""}`;
    case 429:
      return "Dynatrace is rate-limiting this token (429). Wait a minute and try again.";
    default:
      return `${what} failed with ${status}.${detail ? ` ${detail}` : ""}`;
  }
}

function errorDetail(body: unknown): string {
  if (!body || typeof body !== "object") return typeof body === "string" ? body.slice(0, 300) : "";
  const error = (body as { error?: unknown }).error;
  if (!error || typeof error !== "object") return "";
  const { message, constraintViolations } = error as {
    message?: string;
    constraintViolations?: { path?: string; message?: string }[];
  };
  const violations = (constraintViolations ?? [])
    .map((v) => (v.path ? `${v.path}: ${v.message}` : v.message))
    .filter(Boolean);
  return [message, ...violations].filter(Boolean).join(" · ");
}

/** Dynatrace sends Retry-After (seconds) or X-RateLimit-Reset (microseconds since epoch). */
export function retryDelay(response: Pick<Response, "headers">, attempt: number): number {
  const retryAfter = Number(response.headers.get("Retry-After"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1000, 60_000);
  const reset = Number(response.headers.get("X-RateLimit-Reset"));
  if (Number.isFinite(reset) && reset > 0) {
    const wait = reset / 1000 - Date.now();
    if (wait > 0) return Math.min(wait, 60_000);
  }
  return 1000 * 2 ** attempt;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });
}
