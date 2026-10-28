import { useEffect, useRef, useState } from "preact/hooks";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

export interface TimeSeries {
  label: string;
  timestamps: number[];
  values: (number | null)[];
}

const PALETTE = ["#6c72ff", "#1fb5c9", "#f2a93b", "#e5537a", "#4fc27d", "#a36bff", "#3d8bfd", "#d9773e"];

/**
 * Line chart for metric series (uPlot: small, and fast with many series and points). Series may
 * have different timestamps; they are aligned on the union, gaps stay gaps. Redrawn on resize and
 * when the theme changes, since its colours come from the CSS tokens.
 */
export function TimeChart({ series, height = 320 }: { series: TimeSeries[]; height?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const themeTick = useThemeTick();

  useEffect(() => {
    const el = box.current;
    if (!el || !series.length) return;
    const css = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    const muted = token("--muted", "#6b6e88");
    const grid = token("--line", "#e4e5ef");

    const xs = [...new Set(series.flatMap((s) => s.timestamps))].sort((a, b) => a - b);
    const columns = series.map((s) => {
      const byTime = new Map(s.timestamps.map((t, i) => [t, s.values[i] ?? null]));
      return xs.map((t) => byTime.get(t) ?? null);
    });

    const axis = { stroke: muted, grid: { stroke: grid, width: 1 }, ticks: { stroke: grid, width: 1 }, font: "11px system-ui, sans-serif" };
    const chart = new uPlot(
      {
        width: el.clientWidth,
        height,
        ms: 1,
        cursor: { points: { size: 6 } },
        scales: { x: { time: true } },
        axes: [axis, { ...axis, size: 52 }],
        legend: { live: true },
        series: [
          { label: "Time", value: (_u, v) => (v == null ? "" : new Date(v).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })) },
          ...series.map((s, i) => ({
            label: s.label,
            stroke: PALETTE[i % PALETTE.length],
            width: 1.6,
            points: { show: false },
            value: (_u: uPlot, v: number | null) => (v == null ? "—" : v.toLocaleString(undefined, { maximumFractionDigits: 2 })),
          })),
        ],
      },
      [xs, ...columns],
      el,
    );
    const resize = new ResizeObserver(() => chart.setSize({ width: el.clientWidth, height }));
    resize.observe(el);
    return () => {
      resize.disconnect();
      chart.destroy();
    };
  }, [series, height, themeTick]);

  return <div ref={box} class="time-chart" role="img" aria-label="Metric chart" />;
}

/** Changes whenever light/dark changes, by the switch or by the system. */
function useThemeTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    const observer = new MutationObserver(bump);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const media = matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", bump);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", bump);
    };
  }, []);
  return tick;
}
