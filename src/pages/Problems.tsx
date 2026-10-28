import { useState } from "preact/hooks";
import type { Problem } from "../api/types";
import { useCurrent } from "../store/state";
import { confirm, notify, useBusy } from "../ui/feedback";
import { useAsync } from "../ui/hooks";
import { Async, Badge, humanize, PageHead, RangeSelect, time } from "../ui/Page";
import { Table, type Column } from "../ui/Table";

export function Problems() {
  const { client } = useCurrent()!;
  const [from, setFrom] = useState("now-24h");
  const [status, setStatus] = useState("OPEN");
  const state = useAsync(
    (signal) => client.problems({ from, problemSelector: status ? `status("${status}")` : undefined }, signal),
    [client, from, status],
  );
  const [busy, run] = useBusy();

  const close = (rows: Problem[], done?: () => void) =>
    run(async () => {
      const message = prompt(`Comment for closing ${rows.length} problem(s):`, "Closed via DMM");
      if (message === null) return;
      if (!(await confirm({ title: `Close ${rows.length} problem(s)?`, body: <p>Dynatrace closes them now; they reopen if the cause persists.</p>, action: "Close problems" }))) return;
      const results = await Promise.allSettled(rows.map((p) => client.closeProblem(p.problemId, message)));
      const failed = results.filter((r) => r.status === "rejected").length;
      notify(failed ? `${rows.length - failed} closed, ${failed} failed.` : `${rows.length} closed.`, failed ? "error" : "ok");
      done?.();
      state.reload();
    });

  const columns: Column<Problem>[] = [
    { key: "id", label: "ID", value: (p) => p.displayId, render: (p) => <a href={client.uiUrl(`/#problems/problemdetails;pid=${p.problemId}`)} target="_blank" rel="noreferrer">{p.displayId}</a> },
    { key: "title", label: "Title", value: (p) => p.title, wrap: true },
    { key: "severity", label: "Severity", value: (p) => p.severityLevel, render: (p) => <Badge kind={p.severityLevel === "AVAILABILITY" || p.severityLevel === "ERROR" ? "bad" : "warn"}>{humanize(p.severityLevel)}</Badge> },
    { key: "impact", label: "Impact", value: (p) => p.impactLevel, render: (p) => humanize(p.impactLevel) },
    { key: "status", label: "Status", value: (p) => p.status, render: (p) => <Badge kind={p.status === "OPEN" ? "bad" : "ok"}>{humanize(p.status)}</Badge> },
    { key: "root", label: "Root cause", truncate: true, value: (p) => p.rootCauseEntity?.name ?? "" },
    { key: "affected", label: "Affected", align: "right", value: (p) => p.affectedEntities?.length ?? 0, render: (p) => <span title={(p.affectedEntities ?? []).map((e) => e.name).join(", ")}>{p.affectedEntities?.length ?? 0}</span> },
    { key: "start", label: "Started", value: (p) => p.startTime, render: (p) => time(p.startTime) },
  ];

  return (
    <>
      <PageHead title="Problems" reload={state.reload} loading={state.loading}>
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.currentTarget.value)}>
          <option value="OPEN">Open</option>
          <option value="CLOSED">Closed</option>
          <option value="">All</option>
        </select>
        <RangeSelect value={from} onChange={setFrom} />
      </PageHead>
      <Async state={state} what="Loading problems">
        {(problems) => (
          <Table
            name="problems"
            rows={problems}
            columns={columns}
            rowKey={(p) => p.problemId}
            selectable
            empty="No problems in this range."
            bulk={(selected, clear) => (
              <button type="button" disabled={busy} onClick={() => close(selected.filter((p) => p.status === "OPEN"), clear)}>
                Close {selected.filter((p) => p.status === "OPEN").length} open
              </button>
            )}
          />
        )}
      </Async>
    </>
  );
}
