import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

interface Toast {
  id: number;
  kind: "ok" | "error";
  text: string;
}

let toasts: Toast[] = [];
let nextToast = 1;
const toastListeners = new Set<() => void>();

export function notify(text: string, kind: Toast["kind"] = "ok"): void {
  const toast = { id: nextToast++, kind, text };
  toasts = [...toasts, toast];
  toastListeners.forEach((l) => l());
  setTimeout(() => dismiss(toast.id), kind === "error" ? 12_000 : 5_000);
}

export function notifyError(error: unknown): void {
  notify(error instanceof Error ? error.message : String(error), "error");
}

function dismiss(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
  toastListeners.forEach((l) => l());
}

export function Toasts() {
  const [, force] = useState(0);
  useEffect(() => {
    const listener = () => force((n) => n + 1);
    toastListeners.add(listener);
    return () => void toastListeners.delete(listener);
  }, []);
  return (
    <div class="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} class={`toast toast-${t.kind}`}>
          <span>{t.text}</span>
          <button type="button" class="link" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

export function Dialog(props: { title: string; onClose: () => void; children: ComponentChildren; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} class={props.wide ? "wide" : ""} onClose={props.onClose} onCancel={props.onClose}>
      <header>
        <h2>{props.title}</h2>
        <button type="button" class="link" aria-label="Close" onClick={props.onClose}>
          ×
        </button>
      </header>
      <div class="dialog-body">{props.children}</div>
    </dialog>
  );
}

interface ConfirmRequest {
  title: string;
  body: ComponentChildren;
  action: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

let pendingConfirm: ConfirmRequest | null = null;
const confirmListeners = new Set<() => void>();

/** Promise-based confirmation for destructive actions: `if (!(await confirm({...}))) return;` */
export function confirm(request: Omit<ConfirmRequest, "resolve">): Promise<boolean> {
  return new Promise((resolve) => {
    pendingConfirm = { ...request, resolve };
    confirmListeners.forEach((l) => l());
  });
}

export function ConfirmHost() {
  const [, force] = useState(0);
  useEffect(() => {
    const listener = () => force((n) => n + 1);
    confirmListeners.add(listener);
    return () => void confirmListeners.delete(listener);
  }, []);
  if (!pendingConfirm) return null;
  const request = pendingConfirm;
  const close = (ok: boolean) => {
    pendingConfirm = null;
    confirmListeners.forEach((l) => l());
    request.resolve(ok);
  };
  return (
    <Dialog title={request.title} onClose={() => close(false)}>
      <div class="confirm-body">{request.body}</div>
      <div class="actions">
        <button type="button" onClick={() => close(false)}>
          Cancel
        </button>
        <button type="button" class={request.danger ? "danger" : "primary"} onClick={() => close(true)}>
          {request.action}
        </button>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

export function ErrorBox({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div class="error-box" role="alert">
      <p>{error.message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Loading({ what = "Loading" }: { what?: string }) {
  return (
    <p class="loading" aria-busy="true">
      {what}…
    </p>
  );
}

export function JsonView({ value }: { value: unknown }) {
  return <pre class="json">{JSON.stringify(value, null, 2)}</pre>;
}

export function download(filename: string, content: string, type = "application/json"): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function readFile(accept = ".json,application/json"): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      file.text().then(resolve, () => resolve(null));
    };
    input.click();
  });
}

/** Runs async work while disabling the trigger, and reports failures as a toast. */
export function useBusy(): [boolean, (work: () => Promise<void>) => Promise<void>] {
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  };
  return [busy, run];
}
