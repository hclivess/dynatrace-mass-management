import { useState } from "preact/hooks";
import type { MuteReason, SecurityProblem, Slo } from "../api/types";
import { useCurrent } from "../store/state";
import { confirm, Dialog, notify, useBusy } from "../ui/feedback";
import { useAsync } from "../ui/hooks";
import { Async, Badge, humanize, PageHead, RangeSelect, time } from "../ui/Page";
import { Table, type Column } from "../ui/Table";

export function Slos() {
  const { client } = useCurrent()!;
  const [from, setFrom] = useState("now-1w");
  const [creating, setCreating] = useState(false);
  const state = useAsync((signal) => client.slos(from, signal), [client, from]);
  const [busy, run] = useBusy();

  const remove = (rows: Slo[], done: () => void) =>
    run(async () => {
      if (!(await confirm({ title: `Delete ${rows.length} SLO(s)?`, body: <p>{rows.map((r) => r.name).join(", ")}</p>, action: "Delete", danger: true }))) return;
      await Promise.all(rows.map((r) => client.deleteSlo(r.id)));
      notify(`${rows.length} SLO(s) deleted.`);
      done();
      state.reload();
    });

  const columns: Column<Slo>[] = [
    { key: "name", label: "SLO", value: (s) => s.name },
    { key: "status", label: "Status", value: (s) => s.status, render: (s) => <Badge kind={s.status === "SUCCESS" ? "ok" : s.status === "WARNING" ? "warn" : "bad"}>{humanize(s.status)}</Badge> },
    { key: "value", label: "Current", align: "right", value: (s) => s.evaluatedPercentage, render: (s) => (s.evaluatedPercentage < 0 ? "—" : `${s.evaluatedPercentage.toFixed(3)} %`) },
    { key: "target", label: "Target", align: "right", value: (s) => s.target, render: (s) => `${s.target} %` },
    { key: "budget", label: "Error budget", align: "right", value: (s) => s.errorBudget, render: (s) => (s.errorBudget < 0 && s.evaluatedPercentage < 0 ? "—" : <Badge kind={s.errorBudget < 0 ? "bad" : "ok"}>{s.errorBudget.toFixed(3)}</Badge>) },
    { key: "timeframe", label: "Timeframe", value: (s) => s.timeframe },
    { key: "enabled", label: "Enabled", value: (s) => (s.enabled ? "yes" : "no") },
  ];

  return (
    <>
      <PageHead title="SLOs" reload={state.reload} loading={state.loading}>
        <button type="button" class="primary" onClick={() => setCreating(true)}>New SLO…</button>
        <RangeSelect value={from} onChange={setFrom} options={[["now-1d", "Last day"], ["now-1w", "Last week"], ["now-1M", "Last month"]]} />
      </PageHead>
      <p class="intro">Classic SLO API on the environment. Dynatrace's newer SLO service lives on the platform domain, which browsers cannot reach from another site.</p>
      <Async state={state} what="Evaluating SLOs">
        {(rows) => (
          <Table name="slos" rows={rows} columns={columns} rowKey={(s) => s.id} selectable empty="No SLOs defined."
            bulk={(selected, clear) => <button type="button" class="danger-outline" disabled={busy} onClick={() => remove(selected, clear)}>Delete {selected.length}</button>} />
        )}
      </Async>
      {creating && <CreateSlo onClose={() => setCreating(false)} onCreated={state.reload} />}
    </>
  );
}

const SLO_TEMPLATE = {
  name: "Service availability",
  enabled: true,
  customDescription: "Share of successful requests",
  metricName: "service_availability",
  metricExpression: "(100)*(builtin:service.errors.server.successCount:splitBy())/(builtin:service.requestCount.server:splitBy())",
  evaluationType: "AGGREGATE",
  filter: 'type("SERVICE")',
  target: 99.5,
  warning: 99.8,
  timeframe: "-1w",
};

function CreateSlo(props: { onClose: () => void; onCreated: () => void }) {
  const { client } = useCurrent()!;
  const [text, setText] = useState(JSON.stringify(SLO_TEMPLATE, null, 2));
  const [busy, run] = useBusy();
  return (
    <Dialog wide title="New SLO" onClose={props.onClose}>
      <textarea style={{ minHeight: "18rem" }} aria-label="SLO definition" value={text} onInput={(e) => setText(e.currentTarget.value)} />
      <div class="actions">
        <button type="button" onClick={props.onClose}>Cancel</button>
        <button type="button" class="primary" disabled={busy} onClick={() => run(async () => { await client.createSlo(JSON.parse(text)); notify("SLO created."); props.onCreated(); props.onClose(); })}>Create</button>
      </div>
    </Dialog>
  );
}

const MUTE_REASONS: [MuteReason, string][] = [
  ["CONFIGURATION_NOT_AFFECTED", "Configuration not affected"],
  ["FALSE_POSITIVE", "False positive"],
  ["VULNERABLE_CODE_NOT_IN_USE", "Vulnerable code not in use"],
  ["IGNORE", "Ignore"],
  ["OTHER", "Other"],
];

export function Vulnerabilities() {
  const { client } = useCurrent()!;
  const [showMuted, setShowMuted] = useState(false);
  const [muting, setMuting] = useState<SecurityProblem[] | null>(null);
  const state = useAsync((signal) => client.securityProblems(showMuted ? 'status("OPEN")' : 'status("OPEN"),muted("false")', signal), [client, showMuted]);

  const columns: Column<SecurityProblem>[] = [
    { key: "id", label: "ID", value: (p) => p.displayId },
    { key: "title", label: "Title", value: (p) => p.title, wrap: true },
    { key: "risk", label: "Risk", value: (p) => p.riskAssessment?.riskScore, render: (p) => <Badge kind={p.riskAssessment?.riskLevel === "CRITICAL" || p.riskAssessment?.riskLevel === "HIGH" ? "bad" : "warn"}>{humanize(p.riskAssessment?.riskLevel) || "?"} {p.riskAssessment?.riskScore ?? ""}</Badge> },
    { key: "tech", label: "Technology", value: (p) => p.technology ?? "", render: (p) => ({ JAVA: "Java", NODE_JS: "Node.js", DOTNET: ".NET", PYTHON: "Python", GO: "Go", PHP: "PHP", KUBERNETES: "Kubernetes" })[p.technology ?? ""] ?? humanize(p.technology) },
    { key: "cve", label: "CVE", value: (p) => (p.cveIds ?? []).join(" ") },
    { key: "muted", label: "Muted", value: (p) => (p.muted ? "yes" : "") },
    { key: "first", label: "First seen", value: (p) => p.firstSeenTimestamp, render: (p) => time(p.firstSeenTimestamp) },
  ];

  return (
    <>
      <PageHead title="Vulnerabilities" reload={state.reload} loading={state.loading}>
        <label class="row"><input type="checkbox" checked={showMuted} onChange={() => setShowMuted(!showMuted)} /> Show muted</label>
      </PageHead>
      <Async state={state} what="Loading vulnerabilities">
        {(rows) => (
          <Table name="vulnerabilities" rows={rows} columns={columns} rowKey={(p) => p.securityProblemId} selectable empty="No open vulnerabilities."
            bulk={(selected) => <button type="button" onClick={() => setMuting(selected.filter((p) => !p.muted))}>Mute {selected.filter((p) => !p.muted).length}…</button>} />
        )}
      </Async>
      {muting && <MuteDialog problems={muting} onClose={() => setMuting(null)} onDone={state.reload} />}
    </>
  );
}

function MuteDialog(props: { problems: SecurityProblem[]; onClose: () => void; onDone: () => void }) {
  const { client } = useCurrent()!;
  const [reason, setReason] = useState<MuteReason>("CONFIGURATION_NOT_AFFECTED");
  const [comment, setComment] = useState("");
  const [busy, run] = useBusy();
  return (
    <Dialog title={`Mute ${props.problems.length} vulnerabilit${props.problems.length === 1 ? "y" : "ies"}`} onClose={props.onClose}>
      <label class="field"><span>Reason</span>
        <select value={reason} onChange={(e) => setReason(e.currentTarget.value as MuteReason)}>{MUTE_REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </label>
      <label class="field"><span>Comment (kept in the audit trail)</span><input value={comment} onInput={(e) => setComment(e.currentTarget.value)} /></label>
      <div class="actions">
        <button type="button" onClick={props.onClose}>Cancel</button>
        <button type="button" class="primary" disabled={busy || !comment.trim()} onClick={() => run(async () => {
          const results = await Promise.allSettled(props.problems.map((p) => client.muteSecurityProblem(p.securityProblemId, reason, comment.trim())));
          const failed = results.filter((r) => r.status === "rejected").length;
          notify(failed ? `${props.problems.length - failed} muted, ${failed} failed.` : `${props.problems.length} muted.`, failed ? "error" : "ok");
          props.onDone();
          props.onClose();
        })}>Mute</button>
      </div>
    </Dialog>
  );
}
