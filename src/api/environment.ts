/**
 * Turns whatever the user pastes into the root URL of the classic Environment API.
 *
 *   abc12345                                   → https://abc12345.live.dynatrace.com
 *   https://abc12345.live.dynatrace.com/ui/... → https://abc12345.live.dynatrace.com
 *   https://abc12345.apps.dynatrace.com        → https://abc12345.live.dynatrace.com
 *   https://dt.example.com/e/1a2b-3c4d/#...    → https://dt.example.com/e/1a2b-3c4d   (Managed)
 *
 * API tokens (dt0c01.…) authenticate against the classic domain only, so the platform domain
 * (*.apps.*) is mapped back to it rather than rejected.
 */
export interface ParsedEnvironment {
  apiRoot: string;
  /** Short identifier shown in the UI: the tenant ID or the Managed environment ID. */
  tenantId: string;
}

const TENANT_ID = /^[a-z0-9]{3,12}$/i;

export function parseEnvironmentUrl(input: string): ParsedEnvironment {
  const raw = input.trim();
  if (!raw) throw new Error("Enter an environment URL or tenant ID.");

  if (TENANT_ID.test(raw)) {
    const id = raw.toLowerCase();
    return { apiRoot: `https://${id}.live.dynatrace.com`, tenantId: id };
  }

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new Error(`"${raw}" is not a URL or a tenant ID.`);
  }
  if (url.protocol !== "https:" && !isLocalhost(url.hostname)) {
    throw new Error("The environment URL must use https.");
  }

  const managed = url.pathname.match(/^\/e\/([^/]+)/);
  if (managed?.[1]) {
    return { apiRoot: `${url.origin}/e/${managed[1]}`, tenantId: managed[1] };
  }

  // SaaS: <tenant>.<stage>.dynatrace.com / dynatracelabs.com; the platform UI adds "apps.".
  const host = url.hostname.toLowerCase();
  const saas = host.match(/^([a-z0-9]+)\.(?:(sprint|dev)\.)?(?:apps\.|live\.)?(dynatrace(?:labs)?\.com)$/);
  if (saas?.[1] && saas[3]) {
    const [, tenant, stage, domain] = saas;
    const liveHost = stage ? `${tenant}.${stage}.${domain}` : `${tenant}.live.${domain}`;
    return { apiRoot: `https://${liveHost}`, tenantId: tenant };
  }

  // Anything else (a custom domain, a local mock) is taken as the API root as given.
  const path = url.pathname.replace(/\/+$/, "").replace(/\/api(\/.*)?$/, "");
  return { apiRoot: `${url.origin}${path}`, tenantId: host.split(".")[0] ?? host };
}

function isLocalhost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}
