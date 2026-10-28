import { useMemo, useState } from "preact/hooks";
import type { MetricQueryResult } from "../api/types";
import { useCurrent } from "../store/state";
import { useAsync, useRoute } from "../ui/hooks";
import { Async, PageHead, RangeSelect } from "../ui/Page";
import { Table } from "../ui/Table";
import { TimeChart } from "../ui/TimeChart";

export function Metrics() {
  const { client } = useCurrent()!;
  const { params } = useRoute();
  const [selector, setSelector] = useState(params.get("q") ?? "builtin:host.cpu.usage:splitBy(\"dt.entity.host\"):sort(value(avg,descending)):limit(8):names");
  const [from, setFrom] = useState("now-24h");
  const [query, setQuery] = useState<{ selector: string; from: string } | null>(null);

  const catalog = useAsync((signal) => client.metrics("", signal), [client]);
  const result = useAsync(
    (signal) => (query ? client.queryMetrics(query.selector, query.from, undefined, undefined, signal) : Promise.resolve(null)),
    [client, query],
  );

  return (
    <>
      <PageHead title="Metric explorer" />
      <form class="inline" style={{ marginBottom: "0.8rem" }} onSubmit={(e) => { e.preventDefault(); setQuery({ selector: selector.trim(), from }); }}>
        <input style={{ flex: 1, minWidth: "16rem", fontFamily: "var(--mono)" }} aria-label="Metric selector" value={selector} onInput={(e) => setSelector(e.currentTarget.value)} />
        <RangeSelect value={from} onChange={setFrom} />
        <button type="submit" class="primary">Query</button>
      </form>
      {query && (
        <Async state={result} what="Querying">
          {(data) => (data ? <MetricChart data={data} /> : null)}
        </Async>
      )}
      <h3>Available metrics</h3>
      <Async state={catalog} what="Loading metric catalog">
        {(metrics) => (
            <Table
              name="metrics"
              rows={metrics}
              rowKey={(m) => m.metricId}
              onRowClick={(m) => { setSelector(m.metricId); setQuery({ selector: m.metricId, from }); scrollTo({ top: 0, behavior: "smooth" }); }}
              columns={[
                { key: "id", label: "Metric", value: (m) => m.metricId, render: (m) => <code>{m.metricId}</code> },
                { key: "name", label: "Name", value: (m) => m.displayName ?? "" },
                { key: "unit", label: "Unit", value: (m) => m.unit ?? "" },
              ]}
            />
        )}
      </Async>
    </>
  );
}

/** With :names Dynatrace adds "<dim>.name"; show names instead of HOST-… IDs where it did. */
function seriesLabel(s: { metric: string; dimensions: string[]; dimensionMap?: Record<string, string> }): string {
  const map = s.dimensionMap ?? {};
  const named = Object.keys(map).filter((k) => !map[`${k}.name`]).map((k) => map[k]);
  return named.join(" · ") || s.dimensions.join(" · ") || s.metric;
}

const MAX_SERIES = 20;

function MetricChart({ data }: { data: MetricQueryResult }) {
  const series = data.result.flatMap((r) => r.data.map((d) => ({ metric: r.metricId, ...d })));
  const warnings = [...(data.warnings ?? []), ...data.result.flatMap((r) => r.warnings ?? [])];
  const drawn = useMemo(
    () => series.slice(0, MAX_SERIES).map((s) => ({ label: seriesLabel(s), timestamps: s.timestamps, values: s.values })),
    [data],
  );

  return (
    <div class="panel">
      {warnings.map((w) => <div class="notice warn" key={w}>{w}</div>)}
      {series.length === 0 ? <p class="muted">The query returned no data.</p> : <TimeChart series={drawn} />}
      <p class="muted" style={{ margin: "0.5rem 0 0" }}>{series.length} series · resolution {data.resolution}{series.length > MAX_SERIES ? ` · first ${MAX_SERIES} drawn` : ""}</p>
    </div>
  );
}
