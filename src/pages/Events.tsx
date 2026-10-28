import { useState } from "preact/hooks";
import type { DtEvent } from "../api/types";
import { useCurrent } from "../store/state";
import { Dialog, notify, useBusy } from "../ui/feedback";
import { useAsync } from "../ui/hooks";
import { Async, PageHead, RangeSelect, time } from "../ui/Page";
import { Table, type Column } from "../ui/Table";

const INGEST_TYPES = ["CUSTOM_DEPLOYMENT", "CUSTOM_ANNOTATION", "CUSTOM_CONFIGURATION", "CUSTOM_INFO", "MARKED_FOR_TERMINATION", "AVAILABILITY_EVENT", "ERROR_EVENT", "PERFORMANCE_EVENT", "RESOURCE_CONTENTION_EVENT", "CUSTOM_ALERT"];

export function Events() {
  const { client } = useCurrent()!;
  const [from, setFrom] = useState("now-24h");
  const [selector, setSelector] = useState("");
  const [applied, setApplied] = useState("");
  const [ingesting, setIngesting] = useState(false);
  const state = useAsync((signal) => client.events({ from, eventSelector: applied || undefined }, signal), [client, from, applied]);

  const columns: Column<DtEvent>[] = [
    { key: "type", label: "Type", value: (e) => e.eventType },
    { key: "title", label: "Title", value: (e) => e.title, wrap: true },
    { key: "entity", label: "Entity", value: (e) => e.entityId?.name ?? "" },
    { key: "status", label: "Status", value: (e) => e.status ?? "" },
    { key: "start", label: "Start", value: (e) => e.startTime, render: (e) => time(e.startTime) },
  ];

  return (
    <>
      <PageHead title="Events" reload={state.reload} loading={state.loading}>
        <button type="button" class="primary" onClick={() => setIngesting(true)}>
          Send event…
        </button>
        <RangeSelect value={from} onChange={setFrom} />
      </PageHead>
      <form class="inline" style={{ marginBottom: "0.8rem" }} onSubmit={(e) => { e.preventDefault(); setApplied(selector.trim()); }}>
        <input style={{ flex: 1 }} placeholder='Event selector, e.g. eventType("CUSTOM_DEPLOYMENT")' value={selector} onInput={(e) => setSelector(e.currentTarget.value)} />
        <button type="submit">Apply</button>
      </form>
      <Async state={state} what="Loading events">
        {(events) => <Table name="events" rows={events} columns={columns} rowKey={(e) => e.eventId} empty="No events in this range." />}
      </Async>
      {ingesting && <IngestDialog onClose={() => setIngesting(false)} onSent={state.reload} />}
    </>
  );
}

function IngestDialog(props: { onClose: () => void; onSent: () => void }) {
  const { client } = useCurrent()!;
  const [eventType, setType] = useState("CUSTOM_DEPLOYMENT");
  const [title, setTitle] = useState("");
  const [entitySelector, setSelector] = useState('type("HOST"),tag("env:prod")');
  const [properties, setProperties] = useState("");
  const [busy, run] = useBusy();

  return (
    <Dialog title="Send an event" onClose={props.onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const props_ = Object.fromEntries(
              properties.split("\n").map((l) => l.split("=")).filter((p) => p.length >= 2 && p[0]!.trim()).map(([k, ...v]) => [k!.trim(), v.join("=").trim()]),
            );
            const result = await client.ingestEvent({ eventType, title, entitySelector: entitySelector.trim() || undefined, properties: props_ });
            notify(`Event accepted for ${result.reportCount} entit${result.reportCount === 1 ? "y" : "ies"}.`);
            props.onSent();
            props.onClose();
          });
        }}
      >
        <label class="field"><span>Type</span>
          <select value={eventType} onChange={(e) => setType(e.currentTarget.value)}>
            {INGEST_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label class="field"><span>Title</span><input required value={title} onInput={(e) => setTitle(e.currentTarget.value)} placeholder="Release 4.2 to production" /></label>
        <label class="field"><span>Entity selector</span><input value={entitySelector} onInput={(e) => setSelector(e.currentTarget.value)} /><small>Empty sends an environment-wide event.</small></label>
        <label class="field"><span>Properties (one key=value per line)</span><textarea value={properties} onInput={(e) => setProperties(e.currentTarget.value)} placeholder={"dt.event.deployment.version=4.2\ndt.event.deployment.release_stage=production"} /></label>
        <div class="actions">
          <button type="button" onClick={props.onClose}>Cancel</button>
          <button type="submit" class="primary" disabled={busy || !title}>{busy ? "Sending…" : "Send"}</button>
        </div>
      </form>
    </Dialog>
  );
}
