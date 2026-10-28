import { Http, isPlatformToken, type Query } from "./http";
import type * as T from "./types";

/**
 * One Dynatrace environment, Environment API v2 and Settings 2.0 only.
 *
 * Every endpoint here works with a classic API token (dt0c01.…) from a browser. Config API v1
 * calls of DMM 1.x were replaced by their Settings 2.0 schemas; see SCHEMAS in ./schemas.ts.
 */
/** Lists that can grow without bound (problems, events) stop here; the page says so. */
export const LIST_LIMIT = 5000;

export class Dynatrace {
  readonly http: Http;

  constructor(
    apiRoot: string,
    private readonly token: string,
    fetchImpl?: typeof fetch,
  ) {
    this.http = new Http(apiRoot, token, fetchImpl);
  }

  get apiRoot(): string {
    return this.http.apiRoot;
  }

  /** Link into the Dynatrace UI for an entity, problem, etc. */
  uiUrl(path: string): string {
    return `${this.apiRoot}${path}`;
  }

  // ------------------------------------------------------------------ tokens

  get platformToken(): boolean {
    return isPlatformToken(this.token);
  }

  /**
   * Name, scopes and expiry of a classic token. Platform tokens cannot be looked up through the
   * environment, so for those the call just proves the token is accepted.
   */
  async tokenInfo(): Promise<T.TokenInfo | { platform: true }> {
    if (this.platformToken) {
      await this.http.get("/api/v2/settings/schemas", { fields: "schemaId" });
      return { platform: true };
    }
    return this.http.post<T.TokenInfo>("/api/v2/apiTokens/lookup", { token: this.token });
  }

  async listTokens(signal?: AbortSignal): Promise<T.ApiToken[]> {
    const page = await this.http.paginate<T.ApiToken>(
      "/api/v2/apiTokens",
      "apiTokens",
      { pageSize: 1000, fields: "+scopes,+expirationDate,+lastUsedDate,+creationDate,+owner" },
      signal,
    );
    return page.items;
  }

  createToken(name: string, scopes: string[], expirationDate?: string): Promise<{ id: string; token: string; expirationDate?: string }> {
    return this.http.post("/api/v2/apiTokens", { name, scopes, ...(expirationDate ? { expirationDate } : {}) });
  }

  setTokenEnabled(id: string, enabled: boolean): Promise<void> {
    return this.http.put(`/api/v2/apiTokens/${encodeURIComponent(id)}`, { enabled });
  }

  deleteToken(id: string): Promise<void> {
    return this.http.delete(`/api/v2/apiTokens/${encodeURIComponent(id)}`);
  }

  // ------------------------------------------------------------------ entities and tags

  async entities(entitySelector: string, fields = "", from = "now-72h", signal?: AbortSignal): Promise<T.Entity[]> {
    const page = await this.http.paginate<T.Entity>(
      "/api/v2/entities",
      "entities",
      { entitySelector, fields, from, pageSize: 500 },
      signal,
    );
    return page.items;
  }

  entity(id: string, signal?: AbortSignal): Promise<T.Entity> {
    return this.http.get(`/api/v2/entities/${encodeURIComponent(id)}`, {}, signal);
  }

  async entityTypes(signal?: AbortSignal): Promise<{ type: string; displayName?: string }[]> {
    const page = await this.http.paginate<{ type: string; displayName?: string }>("/api/v2/entityTypes", "types", { pageSize: 500 }, signal);
    return page.items;
  }

  addTags(entitySelector: string, tags: { key: string; value?: string }[]): Promise<{ matchedEntitiesCount: number }> {
    return this.http.post("/api/v2/tags", { tags }, { entitySelector });
  }

  deleteTag(entitySelector: string, key: string, value?: string): Promise<{ matchedEntitiesCount: number }> {
    return this.http.delete("/api/v2/tags", value === undefined ? { entitySelector, key, deleteAllWithKey: true } : { entitySelector, key, value });
  }

  // ------------------------------------------------------------------ settings 2.0

  async schemas(signal?: AbortSignal): Promise<T.SchemaStub[]> {
    const result = await this.http.get<{ items: T.SchemaStub[] }>("/api/v2/settings/schemas", {}, signal);
    return result.items ?? [];
  }

  schema(schemaId: string, signal?: AbortSignal): Promise<T.Schema> {
    return this.http.get(`/api/v2/settings/schemas/${encodeURIComponent(schemaId)}`, {}, signal);
  }

  async settings(schemaIds: string, scopes?: string, signal?: AbortSignal): Promise<T.SettingsObject[]> {
    const page = await this.http.paginate<T.SettingsObject>(
      "/api/v2/settings/objects",
      "items",
      {
        schemaIds,
        scopes,
        pageSize: 500,
        fields: "objectId,value,schemaId,schemaVersion,scope,summary,modificationInfo",
      },
      signal,
    );
    return page.items;
  }

  /** Creates or updates many objects in one call; the result has one entry per object, in order. */
  writeSettings(objects: T.SettingsWrite[], validateOnly = false): Promise<T.SettingsWriteResult[]> {
    return this.http.post("/api/v2/settings/objects", objects, { validateOnly });
  }

  updateSetting(objectId: string, value: unknown, schemaVersion?: string): Promise<unknown> {
    return this.http.put(`/api/v2/settings/objects/${encodeURIComponent(objectId)}`, { value, ...(schemaVersion ? { schemaVersion } : {}) });
  }

  deleteSetting(objectId: string): Promise<void> {
    return this.http.delete(`/api/v2/settings/objects/${encodeURIComponent(objectId)}`);
  }

  // ------------------------------------------------------------------ problems and events

  async problems(query: { from?: string; problemSelector?: string } = {}, signal?: AbortSignal): Promise<T.Problem[]> {
    const page = await this.http.paginate<T.Problem>(
      "/api/v2/problems",
      "problems",
      { from: query.from ?? "now-24h", problemSelector: query.problemSelector, pageSize: 500 },
      signal,
      LIST_LIMIT,
    );
    return page.items;
  }

  closeProblem(problemId: string, message: string): Promise<unknown> {
    return this.http.post(`/api/v2/problems/${encodeURIComponent(problemId)}/close`, { message });
  }

  async events(query: { from?: string; eventSelector?: string } = {}, signal?: AbortSignal): Promise<T.DtEvent[]> {
    const page = await this.http.paginate<T.DtEvent>(
      "/api/v2/events",
      "events",
      { from: query.from ?? "now-24h", eventSelector: query.eventSelector, pageSize: 1000 },
      signal,
      LIST_LIMIT,
    );
    return page.items;
  }

  ingestEvent(event: T.EventIngest): Promise<{ reportCount: number; eventIngestResults?: { status: string }[] }> {
    return this.http.post("/api/v2/events/ingest", event);
  }

  // ------------------------------------------------------------------ metrics

  async metrics(text = "", signal?: AbortSignal): Promise<T.MetricDescriptor[]> {
    const page = await this.http.paginate<T.MetricDescriptor>(
      "/api/v2/metrics",
      "metrics",
      { text, pageSize: 500, fields: "displayName,unit,description" },
      signal,
    );
    return page.items;
  }

  queryMetrics(metricSelector: string, from: string, resolution?: string, entitySelector?: string, signal?: AbortSignal): Promise<T.MetricQueryResult> {
    return this.http.get("/api/v2/metrics/query", { metricSelector, from, resolution, entitySelector }, signal);
  }

  // ------------------------------------------------------------------ SLOs

  async slos(from = "now-1w", signal?: AbortSignal): Promise<T.Slo[]> {
    // Dynatrace evaluates at most 25 SLOs per request.
    const page = await this.http.paginate<T.Slo>("/api/v2/slo", "slo", { from, pageSize: 25, evaluate: true }, signal);
    return page.items;
  }

  createSlo(definition: unknown): Promise<unknown> {
    return this.http.post("/api/v2/slo", definition);
  }

  deleteSlo(id: string): Promise<void> {
    return this.http.delete(`/api/v2/slo/${encodeURIComponent(id)}`);
  }

  // ------------------------------------------------------------------ security

  async securityProblems(selector = "", signal?: AbortSignal): Promise<T.SecurityProblem[]> {
    const page = await this.http.paginate<T.SecurityProblem>(
      "/api/v2/securityProblems",
      "securityProblems",
      { securityProblemSelector: selector, pageSize: 500, fields: "+riskAssessment,+managementZones" },
      signal,
    );
    return page.items;
  }

  muteSecurityProblem(id: string, reason: T.MuteReason, comment: string): Promise<void> {
    return this.http.post(`/api/v2/securityProblems/${encodeURIComponent(id)}/mute`, { reason, comment });
  }

  unmuteSecurityProblem(id: string, comment: string): Promise<void> {
    return this.http.post(`/api/v2/securityProblems/${encodeURIComponent(id)}/unmute`, { reason: "AFFECTED", comment });
  }

  // ------------------------------------------------------------------ infrastructure

  async activeGates(signal?: AbortSignal): Promise<T.ActiveGate[]> {
    const result = await this.http.get<{ activeGates: T.ActiveGate[] }>("/api/v2/activeGates", {}, signal);
    return result.activeGates ?? [];
  }

  async networkZones(signal?: AbortSignal): Promise<T.NetworkZone[]> {
    const result = await this.http.get<{ networkZones: T.NetworkZone[] }>("/api/v2/networkZones", {}, signal);
    return result.networkZones ?? [];
  }

  saveNetworkZone(id: string, description: string, alternativeZones: string[] = []): Promise<unknown> {
    return this.http.put(`/api/v2/networkZones/${encodeURIComponent(id)}`, { description, alternativeZones });
  }

  deleteNetworkZone(id: string): Promise<void> {
    return this.http.delete(`/api/v2/networkZones/${encodeURIComponent(id)}`);
  }

  // ------------------------------------------------------------------ extensions

  async extensions(signal?: AbortSignal): Promise<T.Extension[]> {
    const page = await this.http.paginate<T.Extension>("/api/v2/extensions", "extensions", { pageSize: 100 }, signal);
    return page.items;
  }

  async extensionVersions(name: string, signal?: AbortSignal): Promise<T.Extension[]> {
    const page = await this.http.paginate<T.Extension>(`/api/v2/extensions/${encodeURIComponent(name)}`, "extensions", {}, signal);
    return page.items;
  }

  async extensionConfigs(name: string, signal?: AbortSignal): Promise<{ objectId: string; value?: unknown }[]> {
    const page = await this.http.paginate<{ objectId: string; value?: unknown }>(
      `/api/v2/extensions/${encodeURIComponent(name)}/monitoringConfigurations`,
      "items",
      { pageSize: 100 },
      signal,
    );
    return page.items;
  }

  deleteExtensionVersion(name: string, version: string): Promise<unknown> {
    return this.http.delete(`/api/v2/extensions/${encodeURIComponent(name)}/${encodeURIComponent(version)}`);
  }

  // ------------------------------------------------------------------ audit

  async auditLog(from = "now-7d", filter = "", signal?: AbortSignal): Promise<T.AuditEntry[]> {
    const page = await this.http.paginate<T.AuditEntry>("/api/v2/auditlogs", "auditLogs", { from, filter, pageSize: 1000, sort: "-timestamp" }, signal);
    return page.items;
  }

  // ------------------------------------------------------------------ hosts

  /** Hosts with the properties the host table shows. */
  hosts(signal?: AbortSignal): Promise<T.Entity[]> {
    return this.entities(
      'type("HOST")',
      "+tags,+managementZones,+lastSeenTms,+firstSeenTms,+properties.monitoringMode,+properties.state,+properties.osType,+properties.installerVersion,+properties.hostGroupName,+properties.ipAddress,+properties.cpuCores,+properties.physicalMemory,+properties.logicalCpuCores",
      "now-72h",
      signal,
    );
  }

  /** OneAgent inventory (v1, still current): host units and agent versions per host. */
  async oneAgents(signal?: AbortSignal): Promise<T.OneAgentHost[]> {
    const hosts: T.OneAgentHost[] = [];
    let nextPageKey: string | undefined;
    for (let n = 0; n < 50; n++) {
      const page = await this.http.get<{ hosts?: T.OneAgentHost[]; nextPageKey?: string }>(
        "/api/v1/oneagents",
        nextPageKey ? { nextPageKey } : { includeDetails: false, relativeTime: "3days" },
        signal,
      );
      hosts.push(...(page.hosts ?? []));
      nextPageKey = page.nextPageKey ?? undefined;
      if (!nextPageKey) break;
    }
    return hosts;
  }

  // ------------------------------------------------------------------ classic configuration still without a Settings replacement

  async requestNamingRules(signal?: AbortSignal): Promise<{ id: string; name: string }[]> {
    const result = await this.http.get<{ values: { id: string; name: string }[] }>("/api/config/v1/service/requestNaming", {}, signal);
    return result.values ?? [];
  }

  requestNamingRule(id: string): Promise<Record<string, unknown>> {
    return this.http.get(`/api/config/v1/service/requestNaming/${encodeURIComponent(id)}`);
  }

  createRequestNamingRule(rule: unknown): Promise<{ id: string }> {
    return this.http.post("/api/config/v1/service/requestNaming", rule);
  }

  deleteRequestNamingRule(id: string): Promise<void> {
    return this.http.delete(`/api/config/v1/service/requestNaming/${encodeURIComponent(id)}`);
  }

  async dashboards(signal?: AbortSignal): Promise<T.DashboardStub[]> {
    const result = await this.http.get<{ dashboards: T.DashboardStub[] }>("/api/config/v1/dashboards", {}, signal);
    return result.dashboards ?? [];
  }

  dashboard(id: string): Promise<Record<string, unknown>> {
    return this.http.get(`/api/config/v1/dashboards/${encodeURIComponent(id)}`);
  }

  createDashboard(definition: unknown): Promise<{ id: string }> {
    return this.http.post("/api/config/v1/dashboards", definition);
  }

  deleteDashboard(id: string): Promise<void> {
    return this.http.delete(`/api/config/v1/dashboards/${encodeURIComponent(id)}`);
  }

  // ------------------------------------------------------------------ synthetic (v1 is the only browser-reachable monitor API)

  async syntheticMonitors(signal?: AbortSignal): Promise<T.SyntheticMonitor[]> {
    const result = await this.http.get<{ monitors: T.SyntheticMonitor[] }>("/api/v1/synthetic/monitors", {}, signal);
    return result.monitors ?? [];
  }

  /** Enabling needs the whole monitor back with the flag changed; there is no partial update. */
  async setSyntheticEnabled(entityId: string, enabled: boolean): Promise<void> {
    const path = `/api/v1/synthetic/monitors/${encodeURIComponent(entityId)}`;
    const monitor = await this.http.get<Record<string, unknown>>(path);
    await this.http.put(path, { ...monitor, enabled });
  }

  // ------------------------------------------------------------------ releases and logs

  async releases(from = "now-30d", signal?: AbortSignal): Promise<T.Release[]> {
    const page = await this.http.paginate<T.Release>("/api/v2/releases", "releases", { from, pageSize: 1000 }, signal);
    return page.items;
  }

  /** Classic log search: deprecated, works until the end of 2027. Grail cannot be called from a browser. */
  async searchLogs(query: string, from: string, limit = 1000, signal?: AbortSignal): Promise<T.LogRecord[]> {
    const result = await this.http.get<{ results?: T.LogRecord[] }>("/api/v2/logs/search", { query, from, limit, sort: "-timestamp" }, signal);
    return result.results ?? [];
  }

  // ------------------------------------------------------------------ generic

  raw<R = unknown>(method: string, path: string, query?: Query, body?: unknown): Promise<R> {
    return this.http.request<R>(method, path, { query, body });
  }
}
