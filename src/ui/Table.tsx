import type { ComponentChildren } from "preact";
import { useMemo, useState } from "preact/hooks";
import { download } from "./feedback";

export interface Column<T> {
  key: string;
  label: string;
  /** Plain value used for sorting, filtering and export. */
  value: (row: T) => string | number | boolean | null | undefined;
  /** Optional rich cell; defaults to the plain value. */
  render?: (row: T) => ComponentChildren;
  align?: "right";
  width?: string;
  /** Long free text (titles, messages) may wrap; everything else stays on one line. */
  wrap?: boolean;
}

interface TableProps<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  /** Base name for exported files. */
  name: string;
  selectable?: boolean;
  /** Rendered above the table with the current selection, for bulk actions. */
  bulk?: (selected: T[], clear: () => void) => ComponentChildren;
  actions?: (row: T) => ComponentChildren;
  onRowClick?: (row: T) => void;
  empty?: string;
}

const PAGE = 200;

export function Table<T>(props: TableProps<T>) {
  const { rows, columns, rowKey } = props;
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<{ key: string; desc: boolean } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(PAGE);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    let out = needle
      ? rows.filter((row) => columns.some((c) => String(c.value(row) ?? "").toLowerCase().includes(needle)))
      : rows;
    const column = sort && columns.find((c) => c.key === sort.key);
    if (sort && column) {
      out = [...out].sort((a, b) => compare(column.value(a), column.value(b)) * (sort.desc ? -1 : 1));
    }
    return out;
  }, [rows, columns, filter, sort]);

  const selectedRows = rows.filter((row) => selected.has(rowKey(row)));
  const allVisibleSelected = visible.length > 0 && visible.every((row) => selected.has(rowKey(row)));

  const toggle = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelected(next);
  };
  const toggleAll = () => {
    const next = new Set(selected);
    for (const row of visible) {
      if (allVisibleSelected) next.delete(rowKey(row));
      else next.add(rowKey(row));
    }
    setSelected(next);
  };

  const exportRows = (format: "csv" | "json") => {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    if (format === "json") {
      download(`${props.name}-${stamp}.json`, JSON.stringify(visible, null, 2));
    } else {
      const lines = [columns.map((c) => csvCell(c.label)).join(",")];
      for (const row of visible) lines.push(columns.map((c) => csvCell(c.value(row))).join(","));
      download(`${props.name}-${stamp}.csv`, "﻿" + lines.join("\r\n"), "text/csv;charset=utf-8");
    }
  };

  return (
    <div class="table-wrap">
      <div class="table-tools">
        <input
          type="search"
          placeholder="Filter…"
          aria-label="Filter rows"
          value={filter}
          onInput={(e) => {
            setFilter(e.currentTarget.value);
            setLimit(PAGE);
          }}
        />
        <span class="muted">
          {visible.length === rows.length ? `${rows.length}` : `${visible.length} of ${rows.length}`} rows
          {selected.size > 0 && ` · ${selected.size} selected`}
        </span>
        <span class="spacer" />
        <button type="button" class="small" onClick={() => exportRows("csv")} disabled={!visible.length}>
          CSV
        </button>
        <button type="button" class="small" onClick={() => exportRows("json")} disabled={!visible.length}>
          JSON
        </button>
      </div>
      {props.bulk && selectedRows.length > 0 && (
        <div class="bulk-bar">{props.bulk(selectedRows, () => setSelected(new Set()))}</div>
      )}
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              {props.selectable && (
                <th class="check">
                  <input type="checkbox" aria-label="Select all" checked={allVisibleSelected} onChange={toggleAll} />
                </th>
              )}
              {columns.map((c) => (
                <th
                  key={c.key}
                  style={c.width ? { width: c.width } : undefined}
                  class={c.align === "right" ? "num" : ""}
                  aria-sort={sort?.key === c.key ? (sort.desc ? "descending" : "ascending") : undefined}
                >
                  <button
                    type="button"
                    class="sort"
                    onClick={() => setSort(sort?.key === c.key ? { key: c.key, desc: !sort.desc } : { key: c.key, desc: false })}
                  >
                    {c.label}
                    {sort?.key === c.key ? (sort.desc ? " ↓" : " ↑") : ""}
                  </button>
                </th>
              ))}
              {props.actions && <th class="actions-col" />}
            </tr>
          </thead>
          <tbody>
            {visible.slice(0, limit).map((row) => {
              const key = rowKey(row);
              return (
                <tr key={key} class={props.onRowClick ? "clickable" : ""} onClick={() => props.onRowClick?.(row)}>
                  {props.selectable && (
                    <td class="check" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" aria-label="Select row" checked={selected.has(key)} onChange={() => toggle(key)} />
                    </td>
                  )}
                  {columns.map((c) => (
                    <td key={c.key} class={[c.align === "right" ? "num" : "", c.wrap ? "wrap" : ""].join(" ").trim()}>
                      {c.render ? c.render(row) : String(c.value(row) ?? "")}
                    </td>
                  ))}
                  {props.actions && (
                    <td class="actions-col" onClick={(e) => e.stopPropagation()}>
                      <div class="row-actions">{props.actions(row)}</div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {visible.length === 0 && <p class="empty">{rows.length ? "Nothing matches the filter." : (props.empty ?? "Nothing here.")}</p>}
      </div>
      {visible.length > limit && (
        <button type="button" class="more" onClick={() => setLimit(limit + PAGE * 5)}>
          Show more ({visible.length - limit} hidden)
        </button>
      )}
    </div>
  );
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined || a === "") return 1;
  if (b === null || b === undefined || b === "") return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

export function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  // A leading = + - @ makes spreadsheets evaluate the cell; prefix it so exports cannot run formulas.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
