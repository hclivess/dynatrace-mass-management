import type { ComponentChildren } from "preact";
import { ErrorBox, Loading } from "./feedback";
import type { AsyncState } from "./hooks";

/** Heading row shared by every page: title, page actions, reload. The environment is in the top bar. */
export function PageHead(props: { title: string; reload?: () => void; loading?: boolean; global?: boolean; children?: ComponentChildren }) {
  return (
    <div class="page-head">
      <h1>{props.title}</h1>
      <span class="spacer" />
      {props.children}
      {props.reload && (
        <button type="button" onClick={props.reload} disabled={props.loading}>
          {props.loading ? "Loading…" : "Reload"}
        </button>
      )}
    </div>
  );
}

/** Renders loading / error / data for one useAsync result. */
export function Async<T>(props: { state: AsyncState<T>; what?: string; children: (data: T) => ComponentChildren }) {
  const { data, error, loading, reload } = props.state;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (data === undefined) return loading ? <Loading what={props.what} /> : null;
  return <>{props.children(data)}</>;
}

/** RESOURCE_CONTENTION → "Resource contention", FULL_STACK → "Full stack". */
export function humanize(value?: string | null): string {
  if (!value) return "";
  const text = value.replace(/_/g, " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function time(ms?: number | null): string {
  if (!ms || ms < 0) return "";
  return new Date(ms).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "short" });

/** "8 min ago", "3 days ago"; the exact time is in the tooltip. */
export function Ago({ ms }: { ms?: number | null }) {
  if (!ms || ms < 0) return null;
  const seconds = (ms - Date.now()) / 1000;
  const [value, unit] =
    Math.abs(seconds) < 60 ? [seconds, "second"] : Math.abs(seconds) < 3600 ? [seconds / 60, "minute"] : Math.abs(seconds) < 86_400 ? [seconds / 3600, "hour"] : [seconds / 86_400, "day"];
  return <span title={time(ms)}>{RELATIVE.format(Math.round(value), unit as Intl.RelativeTimeFormatUnit)}</span>;
}

export function Badge({ kind, children }: { kind?: "ok" | "bad" | "warn"; children: ComponentChildren }) {
  return <span class={`badge${kind ? ` ${kind}` : ""}`}>{children}</span>;
}

export const RANGES: [string, string][] = [
  ["now-2h", "Last 2 hours"],
  ["now-24h", "Last 24 hours"],
  ["now-72h", "Last 3 days"],
  ["now-7d", "Last 7 days"],
  ["now-30d", "Last 30 days"],
];

export function RangeSelect(props: { value: string; onChange: (value: string) => void; options?: [string, string][] }) {
  return (
    <select aria-label="Time range" value={props.value} onChange={(e) => props.onChange(e.currentTarget.value)}>
      {(props.options ?? RANGES).map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </select>
  );
}
