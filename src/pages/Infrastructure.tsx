import { useState } from "preact/hooks";
import type { ActiveGate, Extension, NetworkZone, SyntheticMonitor } from "../api/types";
import { useCurrent } from "../store/state";
import { confirm, Dialog, JsonView, notify, useBusy } from "../ui/feedback";
import { useAsync } from "../ui/hooks";
import { Async, Badge, humanize, PageHead, time } from "../ui/Page";
import { Table, type Column } from "../ui/Table";

export function ActiveGates() {
  const { client } = useCurrent()!;
  const state = useAsync((signal) => client.activeGates(signal), [client]);
  const columns: Column<ActiveGate>[] = [
    { key: "host", label: "Hostname", value: (a) => a.hostname },
    { key: "state", label: "State", value: (a) => (a.offlineSince ? "offline" : "online"), render: (a) => <Badge kind={a.offlineSince ? "bad" : "ok"}>{a.offlineSince ? `offline since ${time(a.offlineSince)}` : "online"}</Badge> },
    { key: "type", label: "Type", value: (a) => a.type, render: (a) => humanize(a.type) },
    { key: "version", label: "Version", value: (a) => a.version },
    { key: "zone", label: "Network zone", value: (a) => a.networkZone ?? "" },
    { key: "group", label: "Group", value: (a) => a.group ?? "" },
    { key: "update", label: "Auto-update", value: (a) => a.autoUpdateStatus ?? "", render: (a) => (a.autoUpdateStatus === "OUTDATED" ? <Badge kind="warn">Outdated</Badge> : a.autoUpdateStatus === "UP2DATE" ? "Up to date" : humanize(a.autoUpdateStatus)) },
    { key: "modules", label: "Modules", value: (a) => (a.modules ?? []).filter((m) => m.enabled).map((m) => m.type).join(", "), render: (a) => (a.modules ?? []).filter((m) => m.enabled).map((m) => humanize(m.type)).join(", ") },
  ];
  return (
    <>
      <PageHead title="ActiveGates" reload={state.reload} loading={state.loading} />
      <Async state={state} what="Loading ActiveGates">
        {(rows) => <Table name="activegates" rows={rows} columns={columns} rowKey={(a) => a.id} empty="No ActiveGates connected." />}
      </Async>
    </>
  );
}

export function NetworkZones() {
  const { client } = useCurrent()!;
  const state = useAsync((signal) => client.networkZones(signal), [client]);
  const [editing, setEditing] = useState<NetworkZone | null>(null);
  const [busy, run] = useBusy();

  const remove = (zone: NetworkZone) =>
    run(async () => {
      if ((zone.numOfOneAgentsUsing ?? 0) > 0 || (zone.numOfConfiguredActiveGates ?? 0) > 0) {
        notify(`${zone.id} is still used by ${zone.numOfOneAgentsUsing ?? 0} OneAgent(s) and ${zone.numOfConfiguredActiveGates ?? 0} ActiveGate(s). Move them first.`, "error");
        return;
      }
      if (!(await confirm({ title: `Delete network zone ${zone.id}?`, body: <p>No agents use it.</p>, action: "Delete", danger: true }))) return;
      await client.deleteNetworkZone(zone.id);
      notify(`${zone.id} deleted.`);
      state.reload();
    });

  const columns: Column<NetworkZone>[] = [
    { key: "id", label: "Zone", value: (z) => z.id, render: (z) => <code>{z.id}</code> },
    { key: "desc", label: "Description", value: (z) => z.description ?? "" },
    { key: "agents", label: "OneAgents", align: "right", value: (z) => z.numOfOneAgentsUsing ?? 0 },
    { key: "ags", label: "ActiveGates", align: "right", value: (z) => z.numOfConfiguredActiveGates ?? 0 },
    { key: "alt", label: "Alternatives", value: (z) => (z.alternativeZones ?? []).join(", ") },
  ];
  return (
    <>
      <PageHead title="Network zones" reload={state.reload} loading={state.loading}>
        <button type="button" class="primary" onClick={() => setEditing({ id: "" })}>New zone…</button>
      </PageHead>
      <Async state={state} what="Loading network zones">
        {(rows) => (
          <Table name="network-zones" rows={rows} columns={columns} rowKey={(z) => z.id} empty="No network zones."
            actions={(z) => (<><button type="button" class="small" onClick={() => setEditing(z)}>Edit</button><button type="button" class="small danger-outline" disabled={busy || z.id === "default"} onClick={() => remove(z)}>Delete</button></>)} />
        )}
      </Async>
      {editing && <ZoneDialog zone={editing} onClose={() => setEditing(null)} onSaved={state.reload} />}
    </>
  );
}

function ZoneDialog(props: { zone: NetworkZone; onClose: () => void; onSaved: () => void }) {
  const { client } = useCurrent()!;
  const isNew = !props.zone.id;
  const [id, setId] = useState(props.zone.id);
  const [description, setDescription] = useState(props.zone.description ?? "");
  const [alternatives, setAlternatives] = useState((props.zone.alternativeZones ?? []).join(", "));
  const [busy, run] = useBusy();
  return (
    <Dialog title={isNew ? "New network zone" : `Edit ${props.zone.id}`} onClose={props.onClose}>
      <label class="field"><span>Zone ID</span><input disabled={!isNew} value={id} onInput={(e) => setId(e.currentTarget.value.toLowerCase())} placeholder="eu.prague" /><small>Lowercase letters, digits, dots, dashes and underscores.</small></label>
      <label class="field"><span>Description</span><input value={description} onInput={(e) => setDescription(e.currentTarget.value)} /></label>
      <label class="field"><span>Alternative zones (comma-separated)</span><input value={alternatives} onInput={(e) => setAlternatives(e.currentTarget.value)} /></label>
      <div class="actions">
        <button type="button" onClick={props.onClose}>Cancel</button>
        <button type="button" class="primary" disabled={busy || !/^[a-z0-9._-]+$/.test(id)} onClick={() => run(async () => {
          await client.saveNetworkZone(id, description, alternatives.split(",").map((s) => s.trim()).filter(Boolean));
          notify(`${id} saved.`);
          props.onSaved();
          props.onClose();
        })}>Save</button>
      </div>
    </Dialog>
  );
}

export function Extensions() {
  const { client } = useCurrent()!;
  const state = useAsync((signal) => client.extensions(signal), [client]);
  const [viewing, setViewing] = useState<{ name: string; data: unknown } | null>(null);
  const [busy, run] = useBusy();
  const columns: Column<Extension>[] = [
    { key: "name", label: "Extension", value: (e) => e.extensionName },
    { key: "version", label: "Version", value: (e) => e.version },
    { key: "author", label: "Author", value: (e) => e.author?.name ?? "" },
  ];
  return (
    <>
      <PageHead title="Extensions" reload={state.reload} loading={state.loading} />
      <p class="intro">Extensions 2.0 environment API: deprecated by Dynatrace, working until the end of 2027.</p>
      <Async state={state} what="Loading extensions">
        {(rows) => (
          <Table name="extensions" rows={rows} columns={columns} rowKey={(e) => `${e.extensionName}@${e.version}`}
            onRowClick={(e) => run(async () => setViewing({ name: e.extensionName, data: { versions: await client.extensionVersions(e.extensionName), monitoringConfigurations: await client.extensionConfigs(e.extensionName).catch((err: Error) => err.message) } }))}
            actions={(e) => <button type="button" class="small danger-outline" disabled={busy} onClick={() => run(async () => {
              if (!(await confirm({ title: `Remove ${e.extensionName} ${e.version}?`, body: <p>Monitoring configurations using this version stop.</p>, action: "Remove", danger: true }))) return;
              await client.deleteExtensionVersion(e.extensionName, e.version);
              notify(`${e.extensionName} ${e.version} removed.`);
              state.reload();
            })}>Remove</button>} />
        )}
      </Async>
      {viewing && <Dialog wide title={viewing.name} onClose={() => setViewing(null)}><JsonView value={viewing.data} /></Dialog>}
    </>
  );
}

export function Synthetic() {
  const { client } = useCurrent()!;
  const state = useAsync((signal) => client.syntheticMonitors(signal), [client]);
  const [busy, run] = useBusy();
  const toggle = (rows: SyntheticMonitor[], enabled: boolean, done: () => void) =>
    run(async () => {
      const targets = rows.filter((m) => m.enabled !== enabled);
      if (!targets.length) return;
      if (!enabled && !(await confirm({ title: `Disable ${targets.length} monitor(s)?`, body: <p>They stop executing until enabled again.</p>, action: "Disable", danger: true }))) return;
      const results = await Promise.allSettled(targets.map((m) => client.setSyntheticEnabled(m.entityId, enabled)));
      const failed = results.filter((r) => r.status === "rejected").length;
      notify(failed ? `${targets.length - failed} changed, ${failed} failed.` : `${targets.length} monitor(s) ${enabled ? "enabled" : "disabled"}.`, failed ? "error" : "ok");
      done();
      state.reload();
    });
  return (
    <>
      <PageHead title="Synthetic monitors" reload={state.reload} loading={state.loading} />
      <Async state={state} what="Loading monitors">
        {(rows) => (
          <Table name="synthetic" rows={rows} rowKey={(m) => m.entityId} selectable empty="No synthetic monitors."
            columns={[
              { key: "name", label: "Monitor", value: (m) => m.name },
              { key: "type", label: "Type", value: (m) => m.type, render: (m) => humanize(m.type) },
              { key: "enabled", label: "State", value: (m) => (m.enabled ? "enabled" : "disabled"), render: (m) => <Badge kind={m.enabled ? "ok" : "bad"}>{m.enabled ? "enabled" : "disabled"}</Badge> },
            ]}
            bulk={(selected, clear) => (<><button type="button" disabled={busy} onClick={() => toggle(selected, true, clear)}>Enable</button><button type="button" class="danger-outline" disabled={busy} onClick={() => toggle(selected, false, clear)}>Disable</button></>)} />
        )}
      </Async>
    </>
  );
}
