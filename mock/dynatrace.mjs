// A stand-in for the Dynatrace Environment API with invented data. Used by the end-to-end
// self-test (through mock/server.mjs), for the README screenshots, and by the "Try it with sample
// data" button, where it runs inside the browser. Every name and number here is made up.

const HOUR = 3_600_000;
const now = Date.now();

function seeded(seed) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
}

function makeEnvironment(name, hostCount, seed) {
  const rnd = seeded(seed);
  const groups = ["checkout", "search", "payments", "catalog", "edge"];
  const hosts = Array.from({ length: hostCount }, (_, i) => {
    const group = groups[i % groups.length];
    const id = `HOST-${(0xa1b2c3d4e5f60000n + BigInt(seed * 1000 + i)).toString(16).toUpperCase()}`;
    return {
      entityId: id,
      displayName: `${group}-${name}-${String(i + 1).padStart(2, "0")}`,
      type: "HOST",
      lastSeenTms: now - Math.floor(rnd() * 20) * 60_000,
      firstSeenTms: now - 90 * 24 * HOUR,
      tags: [
        { context: "CONTEXTLESS", key: "env", value: name, stringRepresentation: `env:${name}` },
        { context: "CONTEXTLESS", key: "team", value: group, stringRepresentation: `team:${group}` },
      ],
      managementZones: [{ id: "1", name: `${group} (${name})` }],
      properties: {
        monitoringMode: i % 7 === 3 ? "INFRA_ONLY" : "FULL_STACK",
        hostGroupName: group,
        osType: i % 4 === 0 ? "WINDOWS" : "LINUX",
        installerVersion: "1.329.48.20260918-143044",
      },
    };
  });
  const settings = [
    setting("builtin:tags.auto-tagging", "Owner from host group", { name: "Owner from host group", rules: [{ enabled: true, type: "ME", valueFormat: "{HostGroup:Name}", valueNormalization: "Leave text as-is", attributeRule: { entityType: "HOST", conditions: [] } }] }),
    setting("builtin:tags.auto-tagging", "Environment", { name: "Environment", rules: [{ enabled: true, type: "SELECTOR", entitySelector: 'type("HOST")', valueFormat: name, valueNormalization: "Leave text as-is" }] }),
    setting("builtin:tags.auto-tagging", "Kubernetes namespace", { name: "Kubernetes namespace", rules: [] }),
    setting("builtin:alerting.maintenance-window", "Patch Tuesday", { enabled: true, generalProperties: { name: "Patch Tuesday", maintenanceType: "PLANNED", suppression: "DETECT_PROBLEMS_DONT_ALERT", disableSyntheticMonitorExecution: false }, schedule: { scheduleType: "MONTHLY" }, filters: [] }),
    setting("builtin:management-zones", "checkout", { name: "checkout", rules: [] }),
    ...hosts.slice(0, Math.ceil(hostCount / 6)).map((h) => setting("builtin:host.monitoring", "Monitoring disabled", { enabled: false }, h.entityId)),
  ];
  const problems = Array.from({ length: Math.max(1, Math.floor(hostCount / 5)) }, (_, i) => ({
    problemId: `${seed}${i}-problem`,
    displayId: `P-2610${seed}${String(i).padStart(2, "0")}`,
    title: ["High CPU", "Response time degradation", "Failure rate increase", "Disk space low", "Process unavailable"][i % 5],
    status: i % 3 === 2 ? "CLOSED" : "OPEN",
    severityLevel: ["RESOURCE_CONTENTION", "PERFORMANCE", "ERROR", "RESOURCE_CONTENTION", "AVAILABILITY"][i % 5],
    impactLevel: i % 2 ? "SERVICES" : "INFRASTRUCTURE",
    startTime: now - (i + 1) * 47 * 60_000,
    endTime: -1,
    affectedEntities: [{ entityId: { id: hosts[i % hosts.length].entityId }, name: hosts[i % hosts.length].displayName }],
    rootCauseEntity: { name: hosts[i % hosts.length].displayName },
  }));
  return {
    name,
    hosts,
    settings,
    problems,
    activeGates: [
      { id: `ag-${seed}-1`, hostname: `ag-${name}-01`, version: "1.329.30", type: "ENVIRONMENT", osType: "LINUX", networkZone: "default", group: "default", autoUpdateStatus: "UP2DATE", offlineSince: null, modules: [{ type: "KUBERNETES", enabled: true }, { type: "EXTENSIONS_V2", enabled: true }] },
      { id: `ag-${seed}-2`, hostname: `ag-${name}-02`, version: "1.327.12", type: "ENVIRONMENT", osType: "LINUX", networkZone: "default", group: "default", autoUpdateStatus: "OUTDATED", offlineSince: seed === 2 ? now - 5 * HOUR : null, modules: [{ type: "SYNTHETIC", enabled: true }] },
    ],
    slos: [
      { id: `slo-${seed}-1`, name: "Checkout availability", enabled: true, status: "SUCCESS", evaluatedPercentage: 99.962, errorBudget: 0.462, target: 99.5, warning: 99.8, timeframe: "-1w" },
      { id: `slo-${seed}-2`, name: "Search latency under 300 ms", enabled: true, status: seed === 2 ? "FAILURE" : "WARNING", evaluatedPercentage: seed === 2 ? 97.1 : 99.61, errorBudget: seed === 2 ? -1.9 : 0.11, target: 99, warning: 99.7, timeframe: "-1w" },
    ],
    vulnerabilities: Array.from({ length: seed + 2 }, (_, i) => ({
      securityProblemId: `sp-${seed}-${i}`,
      displayId: `S-${400 + seed * 10 + i}`,
      title: ["Remote code execution", "Denial of service", "Information exposure", "Improper input validation"][i % 4],
      status: "OPEN",
      muted: false,
      technology: ["JAVA", "NODE_JS", "DOTNET", "PYTHON"][i % 4],
      cveIds: [`CVE-2026-${10000 + seed * 37 + i}`],
      firstSeenTimestamp: now - (i + 2) * 24 * HOUR,
      riskAssessment: { riskLevel: ["CRITICAL", "HIGH", "MEDIUM", "LOW"][i % 4], riskScore: [9.8, 7.5, 5.3, 3.1][i % 4] },
    })),
    tokens: [{ id: `dt0c01.MOCK${seed}`, name: "dmm", enabled: true, owner: "ops@example.com", scopes: ["entities.read", "settings.read", "settings.write", "problems.read", "metrics.read"], creationDate: new Date(now - 30 * 24 * HOUR).toISOString(), lastUsedDate: new Date(now).toISOString() }],
  };
}

function setting(schemaId, summary, value, scope = "environment") {
  return { objectId: crypto.randomUUID(), schemaId, schemaVersion: "1.0", scope, summary, value, modificationInfo: { lastModifiedTime: now - 3 * 24 * HOUR, lastModifiedBy: "ops@example.com" } };
}


const PERSONAL_SCOPES = ["activeGates.read", "apiTokens.read", "apiTokens.write", "entities.read", "entities.write", "events.ingest", "events.read", "extensionConfigurations.read", "extensions.read", "extensions.write", "metrics.read", "networkZones.read", "networkZones.write", "oneAgents.read", "problems.read", "problems.write", "releases.read", "securityProblems.read", "securityProblems.write", "settings.read", "settings.write", "slo.read", "slo.write"];
const CLASSIC_ONLY_SCOPES = ["ReadConfig", "WriteConfig", "auditLogs.read", "logs.read", "ReadSyntheticData", "ExternalSyntheticIntegration"];

const SCHEMAS = [
  ["builtin:tags.auto-tagging", "Automatically applied tags"],
  ["builtin:alerting.maintenance-window", "Maintenance windows"],
  ["builtin:management-zones", "Management zones"],
  ["builtin:alerting.profile", "Problem alerting profiles"],
  ["builtin:problem.notifications", "Problem notifications"],
  ["builtin:anomaly-detection.metric-events", "Metric events"],
  ["builtin:host.monitoring", "Monitoring"],
  ["builtin:host.monitoring.mode", "Monitoring mode"],
  ["builtin:logmonitoring.log-storage-settings", "Log storage"],
].map(([schemaId, displayName]) => ({ schemaId, displayName, latestSchemaVersion: "1.0" }));

const METRICS = [
  ["builtin:host.cpu.usage", "CPU usage %", "Percent"],
  ["builtin:host.mem.usage", "Memory used %", "Percent"],
  ["builtin:host.disk.free", "Disk available %", "Percent"],
  ["builtin:service.response.time", "Response time", "MicroSecond"],
  ["builtin:service.requestCount.total", "Request count", "Count"],
  ["builtin:service.errors.total.rate", "Failure rate", "Percent"],
].map(([metricId, displayName, unit]) => ({ metricId, displayName, unit }));

// ---------------------------------------------------------------------------


// Like Dynatrace, a follow-up request carries only nextPageKey; the key encodes the original
// query so the handler sees the same filters again.
function page(items, key, url, pageSize = 100) {
  const start = Number(url.searchParams.get("_start") ?? 0);
  const size = Number(url.searchParams.get("pageSize") ?? pageSize) || pageSize;
  const slice = items.slice(start, start + size);
  const following = new URLSearchParams(url.searchParams);
  following.set("_start", String(start + size));
  const next = start + size < items.length ? btoa(following.toString()) : null;
  return { totalCount: items.length, pageSize: size, nextPageKey: next, [key]: slice };
}

function selectorIds(selector) {
  return [...(selector ?? "").matchAll(/"([A-Z]+-[0-9A-F]+)"/g)].map((m) => m[1]);
}

function series(seed, points = 96) {
  const rnd = seeded(seed);
  const step = 15 * 60_000;
  const start = now - points * step;
  let v = 20 + rnd() * 40;
  const timestamps = [];
  const values = [];
  for (let i = 0; i < points; i++) {
    v = Math.min(98, Math.max(2, v + (rnd() - 0.5) * 8 + Math.sin(i / 10) * 1.5));
    timestamps.push(start + i * step);
    values.push(Math.round(v * 100) / 100);
  }
  return { timestamps, values };
}

function route(e, method, path, url, body) {
  const ok = (data, status = 200) => ({ status, body: data });

  if (method === "POST" && path === "/api/v2/apiTokens/lookup") {
    // A token with "PERSONAL" in it behaves like a personal access token: API v2 scopes only.
    const personal = String(body?.token ?? "").includes("PERSONAL");
    const scopes = personal ? PERSONAL_SCOPES : [...PERSONAL_SCOPES, ...CLASSIC_ONLY_SCOPES];
    return ok({ ...e.tokens[0], personalAccessToken: personal, scopes, expirationDate: new Date(now + 60 * 24 * HOUR).toISOString() });
  }
  if (method === "GET" && path === "/api/v2/apiTokens") return ok(page(e.tokens, "apiTokens", url));

  if (method === "GET" && path === "/api/v2/entities") {
    const selector = url.searchParams.get("entitySelector") ?? "";
    const ids = selectorIds(selector);
    let items = selector.includes("HOST") || ids.length ? e.hosts : [];
    if (ids.length) items = items.filter((h) => ids.includes(h.entityId));
    if (selector.includes("SERVICE")) items = e.hosts.slice(0, 6).map((h, i) => ({ ...h, entityId: `SERVICE-${h.entityId.slice(5)}`, displayName: ["CheckoutService", "SearchService", "PaymentGateway", "CatalogApi", "EdgeProxy", "CartService"][i], type: "SERVICE" }));
    return ok(page(items, "entities", url, 50));
  }
  if (method === "GET" && path.startsWith("/api/v2/entities/")) return ok(e.hosts.find((h) => h.entityId === path.split("/").pop()) ?? e.hosts[0]);
  if (method === "GET" && path === "/api/v2/entityTypes") return ok(page([{ type: "HOST", displayName: "Host" }, { type: "SERVICE", displayName: "Service" }, { type: "PROCESS_GROUP", displayName: "Process group" }], "types", url));
  if (path === "/api/v2/tags") {
    const ids = selectorIds(url.searchParams.get("entitySelector"));
    const hosts = e.hosts.filter((h) => ids.includes(h.entityId));
    if (method === "POST") {
            for (const h of hosts) for (const t of body.tags) h.tags.push({ context: "CONTEXTLESS", key: t.key, value: t.value, stringRepresentation: t.value ? `${t.key}:${t.value}` : t.key });
    } else if (method === "DELETE") {
      const key = url.searchParams.get("key");
      for (const h of hosts) h.tags = h.tags.filter((t) => t.key !== key);
    }
    return ok({ matchedEntitiesCount: hosts.length });
  }

  if (method === "GET" && path === "/api/v2/settings/schemas") return ok({ totalCount: SCHEMAS.length, items: SCHEMAS });
  if (method === "GET" && path === "/api/v2/settings/objects") {
    const ids = (url.searchParams.get("schemaIds") ?? "").split(",").filter(Boolean);
    const items = e.settings.filter((s) => !ids.length || ids.includes(s.schemaId));
    return ok(page(items, "items", url));
  }
  if (method === "POST" && path === "/api/v2/settings/objects") {
        const validateOnly = url.searchParams.get("validateOnly") === "true";
    const results = body.map((o) => {
      if (!o.value || typeof o.value !== "object") return { code: 400, error: { code: 400, message: "value is required" } };
      if (validateOnly) return { code: 200 };
      if (o.objectId) {
        const existing = e.settings.find((s) => s.objectId === o.objectId);
        if (existing) existing.value = o.value;
        return { code: 200, objectId: o.objectId };
      }
      const summary = o.value.name ?? o.value.generalProperties?.name ?? (o.schemaId === "builtin:host.monitoring" ? (o.value.enabled ? "Monitoring enabled" : "Monitoring disabled") : "object");
      const created = setting(o.schemaId, summary, o.value, o.scope ?? "environment");
      e.settings.push(created);
      if (o.schemaId === "builtin:host.monitoring.mode") {
        const host = e.hosts.find((h) => h.entityId === o.scope);
        if (host) host.properties.monitoringMode = o.value.monitoringMode;
      }
      return { code: 200, objectId: created.objectId };
    });
    return ok(results);
  }
  if (path.startsWith("/api/v2/settings/objects/")) {
    const id = decodeURIComponent(path.split("/").pop());
    if (method === "DELETE") {
      e.settings = e.settings.filter((s) => s.objectId !== id);
      return ok(undefined, 204);
    }
  }

  // Limits the real API enforces, so the self-test catches requests that would fail there.
  if (method === "GET" && path === "/api/v2/problems" && url.searchParams.has("fields") && Number(url.searchParams.get("pageSize")) > 10) {
    return ok({ error: { code: 400, message: "Page size can't be larger than 10 if the fields parameter is set." } }, 400);
  }
  if (method === "GET" && path === "/api/v2/slo" && url.searchParams.get("evaluate") === "true" && Number(url.searchParams.get("pageSize") ?? 10) > 25) {
    return ok({ error: { code: 400, message: "Exceeded the limit of 25 SLOs that can be evaluated at once." } }, 400);
  }
  if (method === "GET" && path === "/api/v2/problems") {
    const selector = url.searchParams.get("problemSelector") ?? "";
    const status = selector.match(/status\("(\w+)"\)/)?.[1];
    return ok(page(e.problems.filter((p) => !status || p.status === status), "problems", url, 50));
  }
  if (method === "POST" && /\/api\/v2\/problems\/[^/]+\/close$/.test(path)) {
    const id = decodeURIComponent(path.split("/")[4]);
    const p = e.problems.find((x) => x.problemId === id);
    if (p) p.status = "CLOSED";
    return ok({ problemId: id, closing: true });
  }
  if (method === "GET" && path === "/api/v2/events") return ok(page(e.problems.map((p, i) => ({ eventId: `ev-${i}`, eventType: i % 2 ? "CUSTOM_DEPLOYMENT" : "CPU_SATURATED", title: i % 2 ? "Release 4.2 to production" : p.title, startTime: p.startTime, status: "CLOSED", entityId: { name: p.rootCauseEntity.name } })), "events", url));
  if (method === "POST" && path === "/api/v2/events/ingest") return ok({ reportCount: 1, eventIngestResults: [{ status: "OK" }] }, 201);

  if (method === "GET" && path === "/api/v2/metrics") return ok(page(METRICS, "metrics", url));
  if (method === "GET" && path === "/api/v2/metrics/query") {
    const selector = url.searchParams.get("metricSelector") ?? "";
    const metricId = selector.split(":").slice(0, 3).join(":").replace(/:splitBy.*$/, "").replace(/:(sort|limit).*$/, "");
    const data = e.hosts.slice(0, 6).map((h, i) => ({ dimensions: [h.entityId, h.displayName], dimensionMap: { "dt.entity.host": h.entityId, "dt.entity.host.name": h.displayName }, ...series(i + 1 + e.name.length) }));
    return ok({ totalCount: data.length, resolution: "15m", result: [{ metricId, data }] });
  }

  if (method === "GET" && path === "/api/v2/slo") return ok(page(e.slos, "slo", url));
  if (method === "GET" && path === "/api/v2/securityProblems") {
    const muted = (url.searchParams.get("securityProblemSelector") ?? "").includes('muted("false")');
    const all = e.vulnerabilities.filter((v) => !muted || !v.muted);
    if (url.searchParams.get("pageSize") === "1") {
      const risky = all.filter((v) => ["CRITICAL", "HIGH"].includes(v.riskAssessment.riskLevel));
      return ok({ totalCount: risky.length, securityProblems: risky.slice(0, 1) });
    }
    return ok(page(all, "securityProblems", url));
  }
  if (method === "POST" && /\/api\/v2\/securityProblems\/[^/]+\/mute$/.test(path)) {
    const v = e.vulnerabilities.find((x) => x.securityProblemId === decodeURIComponent(path.split("/")[4]));
    if (v) v.muted = true;
    return ok(undefined, 204);
  }
  if (method === "GET" && path === "/api/v2/activeGates") return ok({ activeGates: e.activeGates });
  if (method === "GET" && path === "/api/v2/networkZones") return ok({ networkZones: [{ id: "default", description: "Default zone", numOfOneAgentsUsing: e.hosts.length, numOfConfiguredActiveGates: 2 }, { id: "eu.prague", description: "Prague data centre", alternativeZones: ["default"], numOfOneAgentsUsing: 0, numOfConfiguredActiveGates: 0 }] });
  if (method === "GET" && path === "/api/v2/extensions") return ok(page([{ extensionName: "com.dynatrace.extension.snmp-generic", version: "2.4.1", author: { name: "Dynatrace" } }, { extensionName: "custom:com.example.queue-depth", version: "1.0.3", author: { name: "Platform team" } }], "extensions", url));
  if (method === "GET" && path === "/api/v2/auditlogs") return ok(page(e.settings.slice(0, 8).map((s, i) => ({ logId: `log-${i}`, eventType: i % 3 ? "UPDATE" : "CREATE", category: "CONFIG", entityId: s.schemaId, user: "ops@example.com", timestamp: now - i * 3 * HOUR, success: true })), "auditLogs", url));
  if (method === "GET" && path === "/api/v2/releases") return ok(page([{ name: "checkout", product: "shop", version: "4.2.0", stage: e.name, instances: [{}, {}, {}], problemCount: 1, securityVulnerabilitiesCount: 2 }, { name: "search", product: "shop", version: "2.18.3", stage: e.name, instances: [{}, {}], problemCount: 0, securityVulnerabilitiesCount: 0 }], "releases", url));
  if (method === "GET" && path === "/api/v2/logs/search") return ok({ results: e.problems.map((p, i) => ({ timestamp: p.startTime, status: "ERROR", content: `${p.rootCauseEntity.name} worker-${i}: request failed after 3 retries (upstream timeout)` })) });

  if (method === "GET" && path === "/api/v1/oneagents") return ok({ hosts: e.hosts.map((h, i) => ({ hostInfo: { entityId: h.entityId, displayName: h.displayName, consumedHostUnits: h.properties.monitoringMode === "INFRA_ONLY" ? 0.3 : [1, 2, 4][i % 3], monitoringMode: h.properties.monitoringMode }, active: true, agentVersion: { major: 1, minor: 329, revision: 48 } })) });
  if (method === "GET" && path === "/api/v1/synthetic/monitors") return ok({ monitors: [{ entityId: "SYNTHETIC_TEST-0001", name: "Checkout journey", type: "BROWSER", enabled: true }, { entityId: "HTTP_CHECK-0002", name: "API health", type: "HTTP", enabled: e.name !== "staging" }] });
  if (method === "GET" && path === "/api/config/v1/dashboards") return ok({ dashboards: [{ id: "d-1", name: "Shop overview", owner: "ops@example.com" }, { id: "d-2", name: "Host health", owner: "ops@example.com" }] });
  if (method === "GET" && path === "/api/config/v1/service/requestNaming") return ok({ values: [{ id: "rn-1", name: "Checkout: {Request:Name}" }] });

  return ok({ error: { code: 404, message: `The mock does not implement ${method} ${path}` } }, 404);
}

const TOKEN = /^(dt0c01\.MOCK|dt0s16\.MOCK)/;

/**
 * Answers one request. `path` starts with /e/<environment>/api/…; follow-up pages carry only
 * nextPageKey, exactly like Dynatrace.
 */
export function createMock() {
  const environments = {
    production: makeEnvironment("production", 24, 1),
    staging: makeEnvironment("staging", 9, 2),
    development: makeEnvironment("development", 5, 3),
  };
  return function handle(method, href, authorization, body) {
    const url = new URL(href, "http://mock.invalid");
    const nextPageKey = url.searchParams.get("nextPageKey");
    if (nextPageKey) {
      if ([...url.searchParams.keys()].length > 1) return { status: 400, body: { error: { code: 400, message: "nextPageKey must be the only parameter" } } };
      url.search = atob(nextPageKey);
    }
    const match = url.pathname.match(/^\/e\/([^/]+)(\/.*)$/);
    const env = match && environments[match[1]];
    if (!env) return { status: 404, body: { error: { code: 404, message: "Unknown environment" } } };
    if (!TOKEN.test((authorization ?? "").replace(/^(Api-Token|Bearer) /, ""))) return { status: 401, body: { error: { code: 401, message: "Missing or invalid token" } } };
    try {
      return route(env, method, match[2], url, body);
    } catch (error) {
      return { status: 500, body: { error: { code: 500, message: String(error) } } };
    }
  };
}
