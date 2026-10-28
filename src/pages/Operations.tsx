import { useState } from "preact/hooks";
import { REQUIRED_SCOPES } from "../api/scopes";
import type { ApiToken, AuditEntry, LogRecord, Release } from "../api/types";
import { useCurrent } from "../store/state";
import { confirm, Dialog, notify, useBusy } from "../ui/feedback";
import { useAsync } from "../ui/hooks";
import { Async, Badge, PageHead, RangeSelect, time } from "../ui/Page";
import { Table, type Column } from "../ui/Table";

export function Releases() {
  const { client } = useCurrent()!;
  const [from, setFrom] = useState("now-30d");
  const state = useAsync((signal) => client.releases(from, signal), [client, from]);
  const columns: Column<Release>[] = [
    { key: "name", label: "Release", value: (r) => r.name },
    { key: "product", label: "Product", value: (r) => r.product ?? "" },
    { key: "version", label: "Version", value: (r) => r.version },
    { key: "stage", label: "Stage", value: (r) => r.stage ?? "" },
    { key: "instances", label: "Instances", align: "right", value: (r) => r.instances?.length ?? 0 },
    { key: "problems", label: "Problems", align: "right", value: (r) => r.problemCount ?? 0, render: (r) => (r.problemCount ? <Badge kind="bad">{r.problemCount}</Badge> : "0") },
    { key: "vulns", label: "Vulnerabilities", align: "right", value: (r) => r.securityVulnerabilitiesCount ?? 0 },
  ];
  return (
    <>
      <PageHead title="Releases" reload={state.reload} loading={state.loading}><RangeSelect value={from} onChange={setFrom} /></PageHead>
      <Async state={state} what="Loading releases">{(rows) => <Table name="releases" rows={rows} columns={columns} rowKey={(r) => `${r.name}|${r.version}|${r.stage}`} empty="No releases in this range." />}</Async>
    </>
  );
}

export function Logs() {
  const { client } = useCurrent()!;
  const [query, setQuery] = useState('status="ERROR"');
  const [from, setFrom] = useState("now-2h");
  const [applied, setApplied] = useState<{ query: string; from: string } | null>(null);
  const state = useAsync((signal) => (applied ? client.searchLogs(applied.query, applied.from, 1000, signal) : Promise.resolve([] as LogRecord[])), [client, applied]);
  return (
    <>
      <PageHead title="Log search" />
      <p class="intro">Classic log search, deprecated by Dynatrace and working until the end of 2027. Logs on Grail need DQL on the platform domain, which a browser page cannot call.</p>
      <form class="inline" style={{ marginBottom: "0.8rem" }} onSubmit={(e) => { e.preventDefault(); setApplied({ query, from }); }}>
        <input style={{ flex: 1, minWidth: "16rem", fontFamily: "var(--mono)" }} aria-label="Log query" value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
        <RangeSelect value={from} onChange={setFrom} />
        <button type="submit" class="primary">Search</button>
      </form>
      {applied && (
        <Async state={state} what="Searching">
          {(rows) => (
            <Table name="logs" rows={rows} rowKey={(r) => `${r.timestamp}|${r.content.slice(0, 80)}`} empty="No log lines match."
              columns={[
                { key: "time", label: "Time", value: (r) => r.timestamp, render: (r) => time(r.timestamp), width: "11rem" },
                { key: "status", label: "Status", value: (r) => r.status ?? "", width: "6rem" },
                { key: "content", label: "Content", value: (r) => r.content, render: (r) => <code style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{r.content.slice(0, 600)}</code>, wrap: true },
              ]} />
          )}
        </Async>
      )}
    </>
  );
}

export function Audit() {
  const { client } = useCurrent()!;
  const [from, setFrom] = useState("now-7d");
  const state = useAsync((signal) => client.auditLog(from, "", signal), [client, from]);
  const columns: Column<AuditEntry>[] = [
    { key: "time", label: "Time", value: (a) => a.timestamp, render: (a) => time(a.timestamp) },
    { key: "user", label: "User", value: (a) => a.user },
    { key: "type", label: "Event", value: (a) => a.eventType },
    { key: "category", label: "Category", value: (a) => a.category },
    { key: "entity", label: "Target", value: (a) => a.entityId ?? "" },
    { key: "ok", label: "Result", value: (a) => (a.success ? "ok" : "failed"), render: (a) => <Badge kind={a.success ? "ok" : "bad"}>{a.success ? "ok" : "failed"}</Badge> },
  ];
  return (
    <>
      <PageHead title="Audit log" reload={state.reload} loading={state.loading}><RangeSelect value={from} onChange={setFrom} /></PageHead>
      <Async state={state} what="Loading audit log">{(rows) => <Table name="audit-log" rows={rows} columns={columns} rowKey={(a) => a.logId} empty="Nothing logged in this range." />}</Async>
    </>
  );
}

export function Tokens() {
  const { client } = useCurrent()!;
  const state = useAsync((signal) => client.listTokens(signal), [client]);
  const [creating, setCreating] = useState(false);
  const [busy, run] = useBusy();
  const columns: Column<ApiToken>[] = [
    { key: "name", label: "Token", value: (t) => t.name },
    { key: "owner", label: "Owner", value: (t) => t.owner ?? "" },
    { key: "enabled", label: "State", value: (t) => (t.enabled ? "enabled" : "disabled"), render: (t) => <Badge kind={t.enabled ? "ok" : "bad"}>{t.enabled ? "enabled" : "disabled"}</Badge> },
    { key: "scopes", label: "Scopes", align: "right", value: (t) => t.scopes?.length ?? 0 },
    { key: "used", label: "Last used", value: (t) => t.lastUsedDate ?? "", render: (t) => (t.lastUsedDate ? new Date(t.lastUsedDate).toLocaleDateString() : "never") },
    { key: "expires", label: "Expires", value: (t) => t.expirationDate ?? "", render: (t) => (t.expirationDate ? new Date(t.expirationDate).toLocaleDateString() : "never") },
  ];
  return (
    <>
      <PageHead title="API tokens" reload={state.reload} loading={state.loading}>
        <button type="button" class="primary" onClick={() => setCreating(true)}>New token…</button>
      </PageHead>
      <p class="intro">Classic access tokens. Dynatrace is replacing them with platform tokens, which are managed in Account Management rather than per environment.</p>
      <Async state={state} what="Loading tokens">
        {(rows) => (
          <Table name="api-tokens" rows={rows} columns={columns} rowKey={(t) => t.id} selectable
            bulk={(selected, clear) => (<>
              <button type="button" disabled={busy} onClick={() => run(async () => { await Promise.all(selected.map((t) => client.setTokenEnabled(t.id, false))); notify(`${selected.length} disabled.`); clear(); state.reload(); })}>Disable</button>
              <button type="button" class="danger-outline" disabled={busy} onClick={() => run(async () => {
                if (!(await confirm({ title: `Delete ${selected.length} token(s)?`, body: <p>Anything using them stops working immediately.</p>, action: "Delete", danger: true }))) return;
                await Promise.all(selected.map((t) => client.deleteToken(t.id)));
                notify(`${selected.length} deleted.`);
                clear();
                state.reload();
              })}>Delete</button>
            </>)} />
        )}
      </Async>
      {creating && <CreateToken onClose={() => setCreating(false)} onCreated={state.reload} />}
    </>
  );
}

function CreateToken(props: { onClose: () => void; onCreated: () => void }) {
  const { client } = useCurrent()!;
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Set<string>>(new Set(["entities.read", "metrics.read"]));
  const [days, setDays] = useState("90");
  const [created, setCreated] = useState<string | null>(null);
  const [busy, run] = useBusy();
  if (created) {
    return (
      <Dialog title="Token created" onClose={props.onClose}>
        <p>Copy it now. Dynatrace shows it only once.</p>
        <input readOnly value={created} style={{ width: "100%", fontFamily: "var(--mono)" }} onFocus={(e) => e.currentTarget.select()} />
        <div class="actions"><button type="button" onClick={() => navigator.clipboard.writeText(created).then(() => notify("Copied."))}>Copy</button><button type="button" class="primary" onClick={props.onClose}>Done</button></div>
      </Dialog>
    );
  }
  return (
    <Dialog title="New API token" onClose={props.onClose}>
      <label class="field"><span>Name</span><input autoFocus value={name} onInput={(e) => setName(e.currentTarget.value)} /></label>
      <label class="field"><span>Expires after (days, empty for never)</span><input type="number" min="1" value={days} onInput={(e) => setDays(e.currentTarget.value)} /></label>
      <div class="field"><span>Scopes</span>
        <div style={{ columns: 2 }}>{REQUIRED_SCOPES.map((s) => (
          <label key={s.scope} class="row" title={s.for} style={{ breakInside: "avoid" }}>
            <input type="checkbox" checked={scopes.has(s.scope)} onChange={() => { const n = new Set(scopes); if (n.has(s.scope)) n.delete(s.scope); else n.add(s.scope); setScopes(n); }} />
            <code>{s.scope}</code>
          </label>
        ))}</div>
      </div>
      <div class="actions">
        <button type="button" onClick={props.onClose}>Cancel</button>
        <button type="button" class="primary" disabled={busy || !name.trim() || !scopes.size} onClick={() => run(async () => {
          const expiration = days ? new Date(Date.now() + Number(days) * 86_400_000).toISOString() : undefined;
          const result = await client.createToken(name.trim(), [...scopes], expiration);
          setCreated(result.token);
          props.onCreated();
        })}>Create</button>
      </div>
    </Dialog>
  );
}
