import { useState } from "preact/hooks";
import type { Entity } from "../api/types";
import { useCurrent } from "../store/state";
import { Dialog, JsonView, notify, useBusy } from "../ui/feedback";
import { useAsync } from "../ui/hooks";
import { Async, PageHead, time } from "../ui/Page";
import { Table, type Column } from "../ui/Table";

/** Query any entity selector; select results to add or remove tags in bulk. */
export function Entities() {
  const { client } = useCurrent()!;
  const [selector, setSelector] = useState('type("SERVICE")');
  const [applied, setApplied] = useState('type("SERVICE")');
  const [viewing, setViewing] = useState<Entity | null>(null);
  const [tagging, setTagging] = useState<{ entities: Entity[]; mode: "add" | "remove" } | null>(null);
  const types = useAsync((signal) => client.entityTypes(signal), [client]);
  const state = useAsync((signal) => client.entities(applied, "+tags,+managementZones", "now-72h", signal), [client, applied]);

  const columns: Column<Entity>[] = [
    { key: "name", label: "Name", value: (e) => e.displayName },
    { key: "id", label: "Entity ID", value: (e) => e.entityId, render: (e) => <code>{e.entityId}</code> },
    { key: "tags", label: "Tags", value: (e) => (e.tags ?? []).map((t) => t.stringRepresentation).join(" "), render: (e) => <div class="tags">{(e.tags ?? []).slice(0, 5).map((t) => <span class="badge" key={t.stringRepresentation}>{t.stringRepresentation}</span>)}</div> },
    { key: "zones", label: "Management zones", value: (e) => (e.managementZones ?? []).map((z) => z.name).join(", ") },
    { key: "seen", label: "Last seen", value: (e) => e.lastSeenTms, render: (e) => time(e.lastSeenTms) },
  ];

  return (
    <>
      <PageHead title="Entities & tags" reload={state.reload} loading={state.loading} />
      <form class="inline" style={{ marginBottom: "0.8rem" }} onSubmit={(e) => { e.preventDefault(); setApplied(selector.trim()); }}>
        <select aria-label="Entity type" onChange={(e) => { const t = e.currentTarget.value; if (t) { setSelector(`type("${t}")`); setApplied(`type("${t}")`); } }} value="">
          <option value="">Type…</option>
          {(types.data ?? []).map((t) => <option key={t.type} value={t.type}>{t.displayName ?? t.type}</option>)}
        </select>
        <input style={{ flex: 1, minWidth: "16rem", fontFamily: "var(--mono)" }} aria-label="Entity selector" value={selector} onInput={(e) => setSelector(e.currentTarget.value)} />
        <button type="submit" class="primary">Query</button>
      </form>
      <Async state={state} what="Querying entities">
        {(rows) => (
          <Table
            name="entities"
            rows={rows}
            columns={columns}
            rowKey={(e) => e.entityId}
            selectable
            onRowClick={(e) => client.entity(e.entityId).then(setViewing, () => setViewing(e))}
            bulk={(selected) => (
              <>
                <strong>{selected.length} selected</strong>
                <button type="button" onClick={() => setTagging({ entities: selected, mode: "add" })}>Add tag…</button>
                <button type="button" onClick={() => setTagging({ entities: selected, mode: "remove" })}>Remove tag…</button>
              </>
            )}
          />
        )}
      </Async>
      {viewing && <Dialog wide title={viewing.displayName} onClose={() => setViewing(null)}><JsonView value={viewing} /></Dialog>}
      {tagging && <TagDialog {...tagging} onClose={() => setTagging(null)} onDone={state.reload} />}
    </>
  );
}

function TagDialog(props: { entities: Entity[]; mode: "add" | "remove"; onClose: () => void; onDone: () => void }) {
  const { client } = useCurrent()!;
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [busy, run] = useBusy();
  const ids = props.entities.map((e) => e.entityId);

  return (
    <Dialog title={`${props.mode === "add" ? "Add a tag to" : "Remove a tag from"} ${ids.length} entit${ids.length === 1 ? "y" : "ies"}`} onClose={props.onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            let matched = 0;
            // Entity selectors take up to 100 IDs each.
            for (let i = 0; i < ids.length; i += 100) {
              const selector = `entityId(${ids.slice(i, i + 100).map((id) => `"${id}"`).join(",")})`;
              const result = props.mode === "add"
                ? await client.addTags(selector, [{ key: key.trim(), ...(value.trim() ? { value: value.trim() } : {}) }])
                : await client.deleteTag(selector, key.trim(), value.trim() || undefined);
              matched += result.matchedEntitiesCount ?? 0;
            }
            notify(`${props.mode === "add" ? "Tagged" : "Untagged"} ${matched} entit${matched === 1 ? "y" : "ies"}.`);
            props.onDone();
            props.onClose();
          });
        }}
      >
        <label class="field"><span>Key</span><input required autoFocus value={key} onInput={(e) => setKey(e.currentTarget.value)} placeholder="owner" /></label>
        <label class="field"><span>Value (optional)</span><input value={value} onInput={(e) => setValue(e.currentTarget.value)} placeholder="team-payments" />
          {props.mode === "remove" && <small>Empty removes every tag with this key.</small>}
        </label>
        <p class="muted">Only manual tags (added through the API or UI) can be changed; tags from auto-tag rules or the environment stay.</p>
        <div class="actions">
          <button type="button" onClick={props.onClose}>Cancel</button>
          <button type="submit" class={props.mode === "remove" ? "danger" : "primary"} disabled={busy || !key.trim()}>{props.mode === "add" ? "Add tag" : "Remove tag"}</button>
        </div>
      </form>
    </Dialog>
  );
}
