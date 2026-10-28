import { useState } from "preact/hooks";
import type { DashboardStub } from "../api/types";
import { useCurrent } from "../store/state";
import { confirm, Dialog, download, JsonView, notify, readFile, useBusy } from "../ui/feedback";
import { useAsync } from "../ui/hooks";
import { Async, PageHead } from "../ui/Page";
import { Table } from "../ui/Table";

/** Classic dashboards: export, import, delete. New (platform) dashboards are not reachable from a browser. */
export function Dashboards() {
  const { client } = useCurrent()!;
  const state = useAsync((signal) => client.dashboards(signal), [client]);
  const [busy, run] = useBusy();

  const exportRows = (rows: DashboardStub[]) =>
    run(async () => {
      const full = await Promise.all(rows.map((d) => client.dashboard(d.id)));
      download(rows.length === 1 ? `dashboard-${slug(rows[0]!.name)}.json` : `dashboards-${rows.length}.json`, JSON.stringify(rows.length === 1 ? full[0] : full, null, 2));
    });

  const importFile = () =>
    run(async () => {
      const text = await readFile();
      if (!text) return;
      const parsed: unknown = JSON.parse(text);
      const list = (Array.isArray(parsed) ? parsed : [parsed]) as Record<string, unknown>[];
      // The id belongs to the source environment; Dynatrace assigns a new one.
      for (const d of list) await client.createDashboard({ ...d, id: undefined });
      notify(`Imported ${list.length} dashboard(s).`);
      state.reload();
    });

  const remove = (rows: DashboardStub[], done: () => void) =>
    run(async () => {
      if (!(await confirm({ title: `Delete ${rows.length} dashboard(s)?`, body: <p>{rows.map((r) => r.name).join(", ")}</p>, action: "Delete", danger: true }))) return;
      await Promise.all(rows.map((r) => client.deleteDashboard(r.id)));
      notify(`${rows.length} deleted.`);
      done();
      state.reload();
    });

  return (
    <>
      <PageHead title="Dashboards (classic)" reload={state.reload} loading={state.loading}>
        <button type="button" disabled={busy} onClick={importFile}>Import JSON…</button>
      </PageHead>
      <Async state={state} what="Loading dashboards">
        {(rows) => (
          <Table name="dashboards" rows={rows} rowKey={(d) => d.id} selectable empty="No classic dashboards."
            columns={[
              { key: "name", label: "Dashboard", value: (d) => d.name, render: (d) => <a href={client.uiUrl(`/#dashboard;id=${d.id}`)} target="_blank" rel="noreferrer">{d.name}</a> },
              { key: "owner", label: "Owner", value: (d) => d.owner ?? "" },
            ]}
            bulk={(selected, clear) => (<><button type="button" disabled={busy} onClick={() => exportRows(selected)}>Export</button><button type="button" class="danger-outline" disabled={busy} onClick={() => remove(selected, clear)}>Delete</button></>)} />
        )}
      </Async>
    </>
  );
}

export function RequestNaming() {
  const { client } = useCurrent()!;
  const state = useAsync((signal) => client.requestNamingRules(signal), [client]);
  const [viewing, setViewing] = useState<Record<string, unknown> | null>(null);
  const [busy, run] = useBusy();
  return (
    <>
      <PageHead title="Request naming" reload={state.reload} loading={state.loading}>
        <button type="button" disabled={busy} onClick={() => run(async () => {
          const text = await readFile();
          if (!text) return;
          const parsed: unknown = JSON.parse(text);
          const list = (Array.isArray(parsed) ? parsed : [parsed]) as Record<string, unknown>[];
          for (const rule of list) await client.createRequestNamingRule({ ...rule, id: undefined, metadata: undefined });
          notify(`Imported ${list.length} rule(s).`);
          state.reload();
        })}>Import JSON…</button>
      </PageHead>
      <Async state={state} what="Loading rules">
        {(rows) => (
          <Table name="request-naming" rows={rows} rowKey={(r) => r.id} selectable empty="No request naming rules."
            onRowClick={(r) => run(async () => setViewing(await client.requestNamingRule(r.id)))}
            columns={[{ key: "name", label: "Rule", value: (r) => r.name }]}
            bulk={(selected, clear) => (<>
              <button type="button" disabled={busy} onClick={() => run(async () => download(`request-naming-${selected.length}.json`, JSON.stringify(await Promise.all(selected.map((r) => client.requestNamingRule(r.id))), null, 2)))}>Export</button>
              <button type="button" class="danger-outline" disabled={busy} onClick={() => run(async () => {
                if (!(await confirm({ title: `Delete ${selected.length} rule(s)?`, body: <p>{selected.map((r) => r.name).join(", ")}</p>, action: "Delete", danger: true }))) return;
                await Promise.all(selected.map((r) => client.deleteRequestNamingRule(r.id)));
                notify(`${selected.length} deleted.`);
                clear();
                state.reload();
              })}>Delete</button>
            </>)} />
        )}
      </Async>
      {viewing && <Dialog wide title={String(viewing.namingPattern ?? viewing.id)} onClose={() => setViewing(null)}><JsonView value={viewing} /></Dialog>}
    </>
  );
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "dashboard";
}
