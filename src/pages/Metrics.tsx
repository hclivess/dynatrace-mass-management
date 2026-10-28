import { Chart, Filler, Legend, LinearScale, LineController, LineElement, PointElement, TimeSeriesScale, Tooltip, type ChartConfiguration } from "chart.js";
import { useEffect, useRef, useState } from "preact/hooks";
import type { MetricQueryResult } from "../api/types";
import { useCurrent } from "../store/state";
import { useAsync, useRoute } from "../ui/hooks";
import { Async, PageHead, RangeSelect } from "../ui/Page";
import { Table } from "../ui/Table";

Chart.register(LineController, LineElement, PointElement, LinearScale, TimeSeriesScale, Tooltip, Legend, Filler);

const PALETTE = ["#6c72ff", "#1fb5c9", "#f2a93b", "#e5537a", "#4fc27d", "#a36bff", "#3d8bfd", "#d9773e"];

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

function MetricChart({ data }: { data: MetricQueryResult }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const series = data.result.flatMap((r) => r.data.map((d) => ({ metric: r.metricId, ...d })));
  const warnings = [...(data.warnings ?? []), ...data.result.flatMap((r) => r.warnings ?? [])];

  useEffect(() => {
    if (!canvas.current || !series.length) return;
    const stamps = series.flatMap((s) => s.timestamps);
    const ink = getComputedStyle(document.documentElement).getPropertyValue("--muted").trim() || "#6b7480";
    const config: ChartConfiguration<"line", { x: number; y: number | null }[]> = {
      type: "line",
      data: {
        datasets: series.slice(0, 20).map((s, i) => ({
          label: seriesLabel(s),
          data: s.timestamps.map((t, j) => ({ x: t, y: s.values[j] ?? null })),
          borderColor: PALETTE[i % PALETTE.length],
          backgroundColor: PALETTE[i % PALETTE.length],
          borderWidth: 1.6,
          pointRadius: 0,
          spanGaps: true,
          tension: 0.2,
        })),
      },
      options: {
        animation: false,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: { type: "linear", min: Math.min(...stamps), max: Math.max(...stamps), ticks: { color: ink, callback: (v) => new Date(Number(v)).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }), maxTicksLimit: 8 }, grid: { display: false } },
          y: { ticks: { color: ink }, grid: { color: "rgba(127,127,127,.15)" } },
        },
        plugins: {
          legend: { position: "bottom", labels: { color: ink, boxWidth: 10, boxHeight: 10 } },
          tooltip: { callbacks: { title: (items) => new Date(Number(items[0]?.parsed.x)).toLocaleString() } },
        },
      },
    };
    const chart = new Chart(canvas.current, config);
    return () => chart.destroy();
  }, [data]);

  return (
    <div class="panel">
      {warnings.map((w) => <div class="notice warn" key={w}>{w}</div>)}
      {series.length === 0 ? <p class="muted">The query returned no data.</p> : <div class="chart-box" style={{ height: "320px" }}><canvas ref={canvas} aria-label="Metric chart" role="img" /></div>}
      <p class="muted" style={{ margin: "0.5rem 0 0" }}>{series.length} series · resolution {data.resolution}{series.length > 20 ? " · first 20 drawn" : ""}</p>
    </div>
  );
}
