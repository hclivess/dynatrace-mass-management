import { useMemo, useState } from "preact/hooks";
import { SCHEMA_PRESETS } from "../api/schemas";
import type { SettingsObject, SettingsWrite } from "../api/types";
import { clientFor, useAppState, useCurrent } from "../store/state";
import type { Environment } from "../store/vault";
import { confirm, Dialog, download, JsonView, notify, readFile, useBusy } from "../ui/feedback";
import { navigate, useAsync, useRoute } from "../ui/hooks";
import { Async, PageHead, time } from "../ui/Page";
import { Table, type Column } from "../ui/Table";

/**
 * Settings 2.0, the configuration API Dynatrace keeps. Browse any schema, export and import its
 * objects, delete them, and copy them to other environments — the mass part of DMM.
 */
export function Settings() {
  const { client } = useCurrent()!;
  const { params } = useRoute();
  const schemaId = params.get("schema") ?? SCHEMA_PRESETS[0]!.schemaId;
  const [viewing, setViewing] = useState<SettingsObject | null>(null);
  const [copying, setCopying] = useState<SettingsObject[] | null>(null);
  const [busy, run] = useBusy();

  const schemas = useAsync((signal) => client.schemas(signal), [client]);
  const objects = useAsync((signal) => client.settings(schemaId, undefined, signal), [client, schemaId]);
  const preset = SCHEMA_PRESETS.find((p) => p.schemaId === schemaId);

  const exportObjects = (rows: SettingsObject[]) =>
    download(
      `${schemaId.replace(/[^a-z0-9.-]/gi, "_")}.json`,
      JSON.stringify(rows.map(({ schemaId: s, schemaVersion, scope, value }) => ({ schemaId: s, schemaVersion, scope, value })), null, 2),
    );

  const importObjects = () =>
    run(async () => {
      const text = await readFile();
      if (!text) return;
      const parsed: unknown = JSON.parse(text);
      const list = (Array.isArray(parsed) ? parsed : [parsed]) as Partial<SettingsWrite>[];
      const writes = list.map((o, i) => {
        if (!o || typeof o !== "object" || o.value === undefined) throw new Error(`Entry ${i + 1} has no "value".`);
        return { schemaId: o.schemaId ?? schemaId, scope: o.scope ?? "environment", value: o.value, ...(o.schemaVersion ? { schemaVersion: o.schemaVersion } : {}) };
      });
      if (!(await confirm({ title: `Create ${writes.length} object(s)?`, body: <p>They are validated by Dynatrace first; nothing is written if validation fails.</p>, action: "Create" }))) return;
      const check = await client.writeSettings(writes, true);
      const invalid = check.filter((r) => r.code >= 300);
      if (invalid.length) throw new Error(`Validation failed for ${invalid.length} object(s): ${invalid.map((r) => r.error?.message).filter(Boolean).slice(0, 3).join(" · ")}`);
      await client.writeSettings(writes);
      notify(`Created ${writes.length} object(s).`);
      objects.reload();
    });

  const remove = (rows: SettingsObject[], done: () => void) =>
    run(async () => {
      if (!(await confirm({ title: `Delete ${rows.length} object(s)?`, body: <p>Export them first if you may want them back. This cannot be undone.</p>, action: "Delete", danger: true }))) return;
      const results = await Promise.allSettled(rows.map((r) => client.deleteSetting(r.objectId)));
      const failed = results.filter((r) => r.status === "rejected").length;
      notify(failed ? `${rows.length - failed} deleted, ${failed} failed.` : `${rows.length} deleted.`, failed ? "error" : "ok");
      done();
      objects.reload();
    });

  const columns: Column<SettingsObject>[] = [
    { key: "summary", label: "Summary", value: (o) => o.summary || o.objectId, render: (o) => <span>{stripHtml(o.summary) || <code>{o.objectId.slice(0, 24)}…</code>}</span> },
    { key: "scope", label: "Scope", value: (o) => o.scope },
    { key: "modified", label: "Modified", value: (o) => o.modificationInfo?.lastModifiedTime, render: (o) => time(o.modificationInfo?.lastModifiedTime) },
    { key: "by", label: "By", value: (o) => o.modificationInfo?.lastModifiedBy ?? "" },
  ];

  return (
    <>
      <PageHead title={preset?.label ?? "Settings"} reload={objects.reload} loading={objects.loading}>
        <button type="button" disabled={busy} onClick={importObjects}>Import JSON…</button>
      </PageHead>
      <div class="row" style={{ marginBottom: "0.8rem" }}>
        <SchemaPicker value={schemaId} schemas={schemas.data?.map((s) => ({ id: s.schemaId, name: s.displayName })) ?? []} onChange={(id) => navigate("/settings", { schema: id })} />
        {preset?.replaces && <span class="muted">Replaces the deprecated <code>{preset.replaces}</code></span>}
      </div>
      <Async state={objects} what="Loading settings">
        {(rows) => (
          <Table
            name={schemaId}
            rows={rows}
            columns={columns}
            rowKey={(o) => o.objectId}
            selectable
            onRowClick={setViewing}
            empty="No objects for this schema."
            bulk={(selected, clear) => (
              <>
                <strong>{selected.length} selected</strong>
                <button type="button" class="primary" onClick={() => setCopying(selected)}>Copy to environments…</button>
                <button type="button" onClick={() => exportObjects(selected)}>Export</button>
                <button type="button" class="danger-outline" disabled={busy} onClick={() => remove(selected, clear)}>Delete</button>
              </>
            )}
          />
        )}
      </Async>
      {viewing && (
        <Dialog wide title={stripHtml(viewing.summary) || viewing.objectId} onClose={() => setViewing(null)}>
          <p class="muted">
            <code>{viewing.objectId}</code> · scope <code>{viewing.scope}</code> · schema version {viewing.schemaVersion}
          </p>
          <JsonView value={viewing.value} />
        </Dialog>
      )}
      {copying && <CopyDialog objects={copying} onClose={() => setCopying(null)} />}
    </>
  );
}

function SchemaPicker(props: { value: string; schemas: { id: string; name: string }[]; onChange: (id: string) => void }) {
  const others = useMemo(() => props.schemas.filter((s) => !SCHEMA_PRESETS.some((p) => p.schemaId === s.id)).sort((a, b) => a.id.localeCompare(b.id)), [props.schemas]);
  return (
    <select aria-label="Schema" value={props.value} onChange={(e) => props.onChange(e.currentTarget.value)} style={{ maxWidth: "100%" }}>
      <optgroup label="Common">
        {SCHEMA_PRESETS.map((p) => (
          <option key={p.schemaId} value={p.schemaId}>
            {p.label} ({p.schemaId})
          </option>
        ))}
      </optgroup>
      {others.length > 0 && (
        <optgroup label={`All schemas (${others.length})`}>
          {others.map((s) => (
            <option key={s.id} value={s.id}>
              {s.id} · {s.name}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

interface CopyResult {
  env: Environment;
  created: number;
  skipped: number;
  failed: string[];
}

/**
 * Copies environment-scoped objects to other environments. Validates against each target first
 * (validateOnly), skips objects whose summary already exists there, and reports per environment.
 */
function CopyDialog(props: { objects: SettingsObject[]; onClose: () => void }) {
  const { environments } = useAppState();
  const { env: source } = useCurrent()!;
  const targets = environments.filter((e) => e.id !== source.id);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [skipExisting, setSkipExisting] = useState(true);
  const [results, setResults] = useState<CopyResult[]>([]);
  const [busy, run] = useBusy();

  const portable = props.objects.filter((o) => o.scope === "environment");
  const entityScoped = props.objects.length - portable.length;

  const copy = () =>
    run(async () => {
      setResults([]);
      for (const env of targets.filter((e) => chosen.has(e.id))) {
        const result: CopyResult = { env, created: 0, skipped: 0, failed: [] };
        try {
          const client = clientFor(env);
          const schemaIds = [...new Set(portable.map((o) => o.schemaId))].join(",");
          const existing = skipExisting ? new Set((await client.settings(schemaIds)).map((o) => `${o.schemaId}\n${o.summary}`)) : new Set<string>();
          const sources = portable.filter((o) => {
            const dup = existing.has(`${o.schemaId}\n${o.summary}`);
            if (dup) result.skipped++;
            return !dup;
          });
          const writes = sources.map((o): SettingsWrite => ({ schemaId: o.schemaId, scope: "environment", value: o.value }));
          if (writes.length) {
            // Validate first; write only the objects the target accepts, and say why the rest failed.
            const check = await client.writeSettings(writes, true);
            const valid = writes.filter((_, i) => (check[i]?.code ?? 500) < 300);
            check.forEach((r, i) => {
              if (r.code >= 300) result.failed.push(`${stripHtml(sources[i]?.summary) || "object"}: ${r.error?.message ?? r.code}`);
            });
            if (valid.length) {
              const written = await client.writeSettings(valid);
              result.created = written.filter((r) => r.code < 300).length;
            }
          }
        } catch (error) {
          result.failed.push((error as Error).message);
        }
        setResults((r) => [...r, result]);
      }
    });

  return (
    <Dialog title={`Copy ${portable.length} object(s) from ${source.name}`} onClose={props.onClose}>
      {entityScoped > 0 && <div class="notice warn">{entityScoped} selected object(s) belong to a single host or entity and are left out: entity IDs differ between environments.</div>}
      {targets.length === 0 ? (
        <p>Add another environment first.</p>
      ) : (
        <>
          <p>Copy to:</p>
          {targets.map((env) => (
            <label key={env.id} class="row" style={{ padding: "0.2rem 0" }}>
              <input
                type="checkbox"
                checked={chosen.has(env.id)}
                onChange={() => {
                  const next = new Set(chosen);
                  if (next.has(env.id)) next.delete(env.id);
                  else next.add(env.id);
                  setChosen(next);
                }}
              />
              {env.name}
            </label>
          ))}
          <label class="row" style={{ marginTop: "0.6rem" }}>
            <input type="checkbox" checked={skipExisting} onChange={() => setSkipExisting(!skipExisting)} />
            Skip objects whose name already exists in the target
          </label>
          <p class="muted">References to management zones, entities or alerting profiles by ID point to the source environment; Dynatrace rejects them in the target and they are reported below.</p>
        </>
      )}
      {results.length > 0 && (
        <ul>
          {results.map((r) => (
            <li key={r.env.id}>
              <strong>{r.env.name}</strong>: {r.created} created, {r.skipped} skipped{r.failed.length ? `, ${r.failed.length} failed` : ""}
              {r.failed.length > 0 && (
                <ul class="muted">
                  {r.failed.slice(0, 5).map((f) => <li key={f}>{f}</li>)}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      <div class="actions">
        <button type="button" onClick={props.onClose}>Close</button>
        <button type="button" class="primary" disabled={busy || !chosen.size || !portable.length} onClick={copy}>
          {busy ? "Copying…" : `Copy to ${chosen.size} environment(s)`}
        </button>
      </div>
    </Dialog>
  );
}

function stripHtml(text?: string): string {
  return (text ?? "").replace(/<[^>]*>/g, "").trim();
}
