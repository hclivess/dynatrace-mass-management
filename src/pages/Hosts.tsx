import { HOST_MONITORING, HOST_MONITORING_MODE } from "../api/schemas";
import type { Entity, SettingsObject, SettingsWrite } from "../api/types";
import { useCurrent } from "../store/state";
import { confirm, notify, useBusy } from "../ui/feedback";
import { useAsync } from "../ui/hooks";
import { Ago, Async, Badge, humanize, PageHead } from "../ui/Page";
import { Table, type Column } from "../ui/Table";

interface HostRow {
  host: Entity;
  monitoring?: SettingsObject;
  enabled: boolean;
  mode: string;
  hostUnits?: number;
  agentVersion: string;
}

/**
 * Host inventory, and bulk enable/disable of OneAgent monitoring. Monitoring is a per-host
 * Settings 2.0 object (builtin:host.monitoring) since Config API v1 hosts/{id}/monitoring was
 * deprecated; one batch write changes hundreds of hosts.
 */
export function Hosts() {
  const { client } = useCurrent()!;
  const [busy, run] = useBusy();
  const state = useAsync(
    async (signal) => {
      // Host units and agent versions come from the OneAgent inventory, which some tokens cannot
      // read; the page still works without them and says so.
      const [hosts, monitoring, agents] = await Promise.all([
        client.hosts(signal),
        client.settings(HOST_MONITORING, undefined, signal).catch(() => [] as SettingsObject[]),
        client.oneAgents(signal).catch(() => null),
      ]);
      const byHost = new Map(monitoring.map((o) => [o.scope, o]));
      const agentByHost = new Map((agents ?? []).map((a) => [a.hostInfo.entityId, a]));
      const rows = hosts.map((host): HostRow => {
        const setting = byHost.get(host.entityId);
        const agent = agentByHost.get(host.entityId);
        const v = agent?.agentVersion;
        return {
          host,
          monitoring: setting,
          enabled: setting ? setting.value.enabled !== false : true,
          mode: String(host.properties?.monitoringMode ?? agent?.hostInfo.monitoringMode ?? ""),
          hostUnits: agent ? Number(agent.hostInfo.consumedHostUnits) || undefined : undefined,
          // installerVersion is "1.345.93.20261014-101500"; the build stamp is noise in a table.
          agentVersion: v ? `${v.major}.${v.minor}.${v.revision}` : String(host.properties?.installerVersion ?? "").split(".").slice(0, 3).join("."),
        };
      });
      return { rows, hostUnitsKnown: agents !== null };
    },
    [client],
  );

  const setMonitoring = (rows: HostRow[], enabled: boolean, done: () => void) =>
    run(async () => {
      const targets = rows.filter((r) => r.enabled !== enabled);
      if (!targets.length) return notify(`All selected hosts are already ${enabled ? "enabled" : "disabled"}.`);
      const ok = await confirm({
        title: `${enabled ? "Enable" : "Disable"} monitoring on ${targets.length} host(s)?`,
        body: enabled ? (
          <p>OneAgent resumes sending data from these hosts.</p>
        ) : (
          <p>OneAgent stops monitoring these hosts. They stop consuming host units and stop raising problems until you enable them again.</p>
        ),
        action: enabled ? "Enable" : "Disable",
        danger: !enabled,
      });
      if (!ok) return;
      const writes: SettingsWrite[] = targets.map((r) => ({
        schemaId: HOST_MONITORING,
        scope: r.host.entityId,
        value: { ...(r.monitoring?.value ?? {}), enabled },
        ...(r.monitoring ? { objectId: r.monitoring.objectId } : {}),
      }));
      let failed = 0;
      for (let i = 0; i < writes.length; i += 100) {
        const results = await client.writeSettings(writes.slice(i, i + 100));
        failed += results.filter((r) => r.code >= 300).length;
      }
      notify(failed ? `${targets.length - failed} changed, ${failed} failed.` : `Monitoring ${enabled ? "enabled" : "disabled"} on ${targets.length} host(s).`, failed ? "error" : "ok");
      done();
      state.reload();
    });

  const setMode = (rows: HostRow[], mode: string, done: () => void) =>
    run(async () => {
      if (!(await confirm({ title: `Switch ${rows.length} host(s) to ${mode}?`, body: <p>Changing monitoring mode changes host-unit consumption. Full-stack restarts of monitored processes may be needed.</p>, action: "Switch" }))) return;
      const results = await client.writeSettings(rows.map((r) => ({ schemaId: HOST_MONITORING_MODE, scope: r.host.entityId, value: { monitoringMode: mode } })));
      const failed = results.filter((r) => r.code >= 300).length;
      notify(failed ? `${rows.length - failed} switched, ${failed} failed.` : `${rows.length} host(s) switched to ${mode}.`, failed ? "error" : "ok");
      done();
      state.reload();
    });

  const columns: Column<HostRow>[] = [
    { key: "name", label: "Host", truncate: true, value: (r) => r.host.displayName, render: (r) => <a href={client.uiUrl(`/#newhosts/hostdetails;id=${r.host.entityId}`)} target="_blank" rel="noreferrer">{r.host.displayName}</a> },
    { key: "monitoring", label: "Monitoring", value: (r) => (r.enabled ? "enabled" : "disabled"), render: (r) => <Badge kind={r.enabled ? "ok" : "bad"}>{r.enabled ? "enabled" : "disabled"}</Badge> },
    { key: "mode", label: "Mode", value: (r) => r.mode, render: (r) => humanize(r.mode) },
    { key: "group", label: "Host group", value: (r) => String(r.host.properties?.hostGroupName ?? "") },
    { key: "os", label: "OS", value: (r) => String(r.host.properties?.osType ?? ""), render: (r) => humanize(String(r.host.properties?.osType ?? "")) },
    { key: "units", label: "Host units", align: "right", value: (r) => r.hostUnits },
    { key: "agent", label: "Agent", value: (r) => r.agentVersion },
    { key: "seen", label: "Last seen", value: (r) => r.host.lastSeenTms, render: (r) => <Ago ms={r.host.lastSeenTms} /> },
    { key: "tags", label: "Tags", truncate: true, value: (r) => (r.host.tags ?? []).map((t) => t.stringRepresentation).join(" "), render: (r) => <div class="tags">{(r.host.tags ?? []).slice(0, 1).map((t) => <span class="badge" key={t.stringRepresentation}>{t.stringRepresentation}</span>)}{(r.host.tags?.length ?? 0) > 1 && <span class="muted">+{r.host.tags!.length - 1}</span>}</div> },
  ];

  return (
    <>
      <PageHead title="Hosts" reload={state.reload} loading={state.loading} />
      <Async state={state} what="Loading hosts">
        {({ rows, hostUnitsKnown }) => (
          <>
            <div class="grid" style={{ marginBottom: "1rem" }}>
              <div class="tile"><div class="label">Hosts</div><div class="value">{rows.length}</div></div>
              <div class="tile"><div class="label">Monitoring disabled</div><div class={`value${rows.some((r) => !r.enabled) ? " bad" : ""}`}>{rows.filter((r) => !r.enabled).length}</div></div>
              <div class="tile" title={hostUnitsKnown ? undefined : "The token cannot read the OneAgent inventory (oneAgents.read)."}><div class="label">Host units</div><div class="value">{hostUnitsKnown ? round(rows.reduce((s, r) => s + (r.hostUnits ?? 0), 0)) : "n/a"}</div></div>
              <div class="tile"><div class="label">Host groups</div><div class="value">{new Set(rows.map((r) => r.host.properties?.hostGroupName).filter(Boolean)).size}</div></div>
            </div>
            <Table
              name="hosts"
              rows={rows}
              columns={hostUnitsKnown ? columns : columns.filter((c) => c.key !== "units")}
              rowKey={(r) => r.host.entityId}
              selectable
              empty="No hosts reported in the last 3 days."
              bulk={(selected, clear) => (
                <>
                  <strong>{selected.length} selected</strong>
                  <button type="button" disabled={busy} onClick={() => setMonitoring(selected, true, clear)}>Enable monitoring</button>
                  <button type="button" class="danger-outline" disabled={busy} onClick={() => setMonitoring(selected, false, clear)}>Disable monitoring</button>
                  <select
                    aria-label="Monitoring mode"
                    disabled={busy}
                    value=""
                    onChange={(e) => {
                      const mode = e.currentTarget.value;
                      e.currentTarget.value = "";
                      if (mode) setMode(selected, mode, clear);
                    }}
                  >
                    <option value="">Set mode…</option>
                    <option value="FULL_STACK">Full-stack</option>
                    <option value="INFRA_ONLY">Infrastructure</option>
                    <option value="DISCOVERY">Discovery</option>
                  </select>
                  <span class="muted">Tip: filter by host group, then select all.</span>
                </>
              )}
            />
          </>
        )}
      </Async>
    </>
  );
}

function round(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
