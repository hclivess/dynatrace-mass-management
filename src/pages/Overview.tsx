import { useState } from "preact/hooks";
import type { Dynatrace } from "../api/dynatrace";
import { clientFor, selectEnvironment, useAppState } from "../store/state";
import type { Environment } from "../store/vault";
import { useAsync } from "../ui/hooks";
import { Badge, PageHead } from "../ui/Page";
import { Table, type Column } from "../ui/Table";

/**
 * Every environment side by side. Each figure is fetched independently, so a missing scope or a
 * slow tenant costs one cell, not the whole row.
 */
interface Row {
  env: Environment;
  hosts: Cell;
  problems: Cell;
  vulnerabilities: Cell;
  activeGatesOffline: Cell;
  slosFailing: Cell;
}

type Cell = { value: number } | { error: string } | undefined;

const FIGURES: { key: keyof Omit<Row, "env">; load: (c: Dynatrace, s: AbortSignal) => Promise<number> }[] = [
  { key: "hosts", load: async (c, s) => (await c.http.get<{ totalCount: number }>("/api/v2/entities", { entitySelector: 'type("HOST")', from: "now-72h", pageSize: 1 }, s)).totalCount },
  { key: "problems", load: async (c, s) => (await c.http.get<{ totalCount: number }>("/api/v2/problems", { problemSelector: 'status("OPEN")', from: "now-30d", pageSize: 1 }, s)).totalCount },
  {
    key: "vulnerabilities",
    load: async (c, s) =>
      (await c.http.get<{ totalCount: number }>("/api/v2/securityProblems", { securityProblemSelector: 'status("OPEN"),muted("false"),riskLevel("CRITICAL","HIGH")', pageSize: 1 }, s)).totalCount,
  },
  { key: "activeGatesOffline", load: async (c, s) => (await c.activeGates(s)).filter((ag) => ag.offlineSince).length },
  { key: "slosFailing", load: async (c, s) => (await c.slos("now-1w", s)).filter((slo) => slo.status === "FAILURE").length },
];

export function Overview() {
  const { environments } = useAppState();
  const [cells, setCells] = useState<Record<string, Partial<Row>>>({});

  const state = useAsync(
    async (signal) => {
      setCells({});
      await Promise.all(
        environments.flatMap((env) =>
          FIGURES.map(async (figure) => {
            let cell: Cell;
            try {
              cell = { value: await figure.load(clientFor(env), signal) };
            } catch (error) {
              if (signal.aborted) return;
              cell = { error: (error as Error).message };
            }
            setCells((all) => ({ ...all, [env.id]: { ...all[env.id], [figure.key]: cell } }));
          }),
        ),
      );
      return true;
    },
    [environments],
  );

  const rows: Row[] = environments.map((env) => ({
    env,
    hosts: cells[env.id]?.hosts,
    problems: cells[env.id]?.problems,
    vulnerabilities: cells[env.id]?.vulnerabilities,
    activeGatesOffline: cells[env.id]?.activeGatesOffline,
    slosFailing: cells[env.id]?.slosFailing,
  }));

  const num = (key: keyof Omit<Row, "env">, label: string, badWhenAbove?: number): Column<Row> => ({
    key,
    label,
    align: "right",
    value: (row) => (row[key] && "value" in row[key]! ? (row[key] as { value: number }).value : null),
    render: (row) => {
      const cell = row[key];
      if (!cell) return <span class="muted">…</span>;
      if ("error" in cell) return <span class="badge" title={cell.error}>n/a</span>;
      if (badWhenAbove !== undefined) return <Badge kind={cell.value > badWhenAbove ? "bad" : "ok"}>{cell.value}</Badge>;
      return cell.value;
    },
  });

  const totals = FIGURES.map((f) => rows.reduce((sum, row) => sum + (row[f.key] && "value" in row[f.key]! ? (row[f.key] as { value: number }).value : 0), 0));

  return (
    <>
      <PageHead global title="All environments" reload={state.reload} loading={state.loading} />
      <p class="intro">Live figures from every environment in your list. Click a row to work in that environment. “n/a” means the token lacks the scope for that figure; hover it for the reason.</p>
      <div class="grid" style={{ marginBottom: "1rem" }}>
        <Tile label="Environments" value={environments.length} />
        <Tile label="Hosts" value={totals[0]} />
        <Tile label="Open problems" value={totals[1]} bad={totals[1]! > 0} />
        <Tile label="Critical/high vulnerabilities" value={totals[2]} bad={totals[2]! > 0} />
        <Tile label="ActiveGates offline" value={totals[3]} bad={totals[3]! > 0} />
        <Tile label="SLOs failing" value={totals[4]} bad={totals[4]! > 0} />
      </div>
      <Table
        name="environments"
        rows={rows}
        rowKey={(r) => r.env.id}
        onRowClick={(r) => {
          selectEnvironment(r.env.id);
          location.hash = "#/hosts";
        }}
        columns={[
          { key: "name", label: "Environment", value: (r) => r.env.name, render: (r) => <strong>{r.env.name}</strong> },
          num("hosts", "Hosts"),
          num("problems", "Open problems", 0),
          num("vulnerabilities", "Crit/high vulns", 0),
          num("activeGatesOffline", "AGs offline", 0),
          num("slosFailing", "SLOs failing", 0),
        ]}
      />
    </>
  );
}

function Tile(props: { label: string; value?: number; bad?: boolean }) {
  return (
    <div class="tile">
      <div class="label">{props.label}</div>
      <div class={`value${props.bad ? " bad" : ""}`}>{props.value ?? "…"}</div>
    </div>
  );
}
