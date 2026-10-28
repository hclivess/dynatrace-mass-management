import { useEffect, useState } from "preact/hooks";
import { demoEnvironments } from "../api/demo";
import { parseEnvironmentUrl } from "../api/environment";
import { REQUIRED_SCOPES } from "../api/scopes";
import { clientFor, getState, isRemembered, rememberOnDevice, setEnvironments, useAppState } from "../store/state";
import { forgetEverything, importFile, newId, seal, type Environment } from "../store/vault";
import { confirm, Dialog, download, notify, notifyError, readFile, useBusy } from "../ui/feedback";

/** The environment list: add, test, edit, remove, import/export, and remember-on-device. */
export function Environments() {
  const { environments, passphrase } = useAppState();
  const [editing, setEditing] = useState<Environment | null>(null);
  const checks = useChecks();
  const [askPassphrase, setAskPassphrase] = useState<"remember" | "export" | null>(null);

  const test = async (env: Environment) => {
    setCheck(env.id, { state: "checking" });
    setCheck(env.id, await checkToken(env));
  };

  const remove = async (env: Environment) => {
    if (!(await confirm({ title: `Remove ${env.name}?`, body: <p>The token is forgotten in this browser. Nothing changes in Dynatrace.</p>, action: "Remove", danger: true }))) return;
    await setEnvironments(environments.filter((e) => e.id !== env.id));
  };

  const importEnvs = async () => {
    const text = await readFile();
    if (!text) return;
    try {
      const imported = await importFile(text, async () => prompt("Passphrase for this vault file:"));
      const known = new Set(environments.map((e) => `${e.url}\n${e.token}`));
      const fresh = imported.filter((e) => !known.has(`${e.url}\n${e.token}`));
      await setEnvironments([...environments, ...fresh]);
      notify(`Imported ${fresh.length} environment(s)${imported.length > fresh.length ? `, ${imported.length - fresh.length} already in the list` : ""}.`);
    } catch (error) {
      notifyError(error);
    }
  };

  return (
    <>
      <div class="page-head">
        <h1>Environments</h1>
        <span class="spacer" />
        <button type="button" class="primary" onClick={() => setEditing({ id: newId(), name: "", url: "", token: "" })}>
          Add environment
        </button>
      </div>
      <p class="intro">
        Every call goes straight from this browser to Dynatrace. Tokens never leave your machine: they live in this tab until it closes, or encrypted on this device if you choose to remember them.
      </p>

      {environments.length === 0 ? (
        <div class="notice">
          <p style={{ margin: "0 0 0.6rem" }}>No environments yet. Add one with its URL and an API token, or import a file.</p>
          <button
            type="button"
            onClick={async () => {
              await setEnvironments(demoEnvironments());
              location.hash = "#/";
            }}
          >
            Try it with sample data
          </button>{" "}
          <span class="muted">Three invented environments, answered inside this page. Nothing is sent anywhere.</span>
        </div>
      ) : (
        <ul class="env-list">
          {environments.map((env) => (
            <li key={env.id}>
              <div style={{ flex: 1, minWidth: "14rem" }}>
                <div class="name">{env.name}</div>
                <div class="url">{safeApiRoot(env.url)}</div>
                <TokenStatus check={checks[env.id]} />
              </div>
              <button type="button" class="small" onClick={() => test(env)}>
                Test
              </button>
              <button type="button" class="small" onClick={() => setEditing(env)}>
                Edit
              </button>
              <button type="button" class="small danger-outline" onClick={() => remove(env)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div class="row">
        <button type="button" onClick={importEnvs}>
          Import…
        </button>
        <button type="button" disabled={!environments.length} onClick={() => setAskPassphrase("export")}>
          Export encrypted…
        </button>
        <span class="spacer" />
        {isRemembered() ? (
          <button
            type="button"
            onClick={async () => {
              await rememberOnDevice(null);
              notify("This device no longer remembers the environments. They stay until the tab closes.");
            }}
          >
            Stop remembering on this device
          </button>
        ) : (
          <button type="button" disabled={!environments.length} onClick={() => setAskPassphrase("remember")}>
            Remember on this device…
          </button>
        )}
        <button
          type="button"
          class="danger-outline"
          onClick={async () => {
            if (!(await confirm({ title: "Forget everything?", body: <p>Removes every environment and token from this browser, including the encrypted copy.</p>, action: "Forget", danger: true }))) return;
            forgetEverything();
            await rememberOnDevice(null);
            await setEnvironments([]);
          }}
        >
          Forget everything
        </button>
      </div>
      {passphrase && <p class="muted">Remembered on this device, encrypted with your passphrase.</p>}

      {editing && (
        <EditEnvironment
          env={editing}
          onClose={() => setEditing(null)}
          onSave={async (env) => {
            const exists = getState().environments.some((e) => e.id === env.id);
            await setEnvironments(exists ? getState().environments.map((e) => (e.id === env.id ? env : e)) : [...getState().environments, env]);
            setEditing(null);
            // Stay here to see the token check, even when this was the first environment.
            if (location.hash !== "#/environments") location.hash = "#/environments";
            test(env);
          }}
        />
      )}

      {askPassphrase && (
        <PassphraseDialog
          mode={askPassphrase}
          onClose={() => setAskPassphrase(null)}
          onDone={async (secret) => {
            if (askPassphrase === "remember") {
              await rememberOnDevice(secret);
              notify("Remembered on this device. You will be asked for the passphrase when you come back.");
            } else {
              download("environments.dmm-vault.json", JSON.stringify(await seal(environments, secret), null, 2));
            }
            setAskPassphrase(null);
          }}
        />
      )}
    </>
  );
}

function safeApiRoot(url: string): string {
  try {
    return parseEnvironmentUrl(url).apiRoot;
  } catch (error) {
    return (error as Error).message;
  }
}

// ---------------------------------------------------------------------------

type TokenCheck =
  | { state: "checking" }
  | { state: "ok"; name: string; missing: string[]; expires?: string }
  | { state: "platform" }
  | { state: "error"; message: string };

// Results outlive the page component: adding the first environment re-renders the whole shell.
let checkResults: Record<string, TokenCheck> = {};
const checkListeners = new Set<() => void>();

function setCheck(id: string, check: TokenCheck): void {
  checkResults = { ...checkResults, [id]: check };
  checkListeners.forEach((l) => l());
}

function useChecks(): Record<string, TokenCheck> {
  const [, force] = useState(0);
  useEffect(() => {
    const listener = () => force((n) => n + 1);
    checkListeners.add(listener);
    return () => void checkListeners.delete(listener);
  }, []);
  return checkResults;
}

async function checkToken(env: Environment): Promise<TokenCheck> {
  try {
    const info = await clientFor(env).tokenInfo();
    if ("platform" in info) return { state: "platform" };
    const granted = new Set(info.scopes);
    return {
      state: "ok",
      name: info.name,
      missing: REQUIRED_SCOPES.filter((s) => !granted.has(s.scope)).map((s) => s.scope),
      expires: info.expirationDate,
    };
  } catch (error) {
    return { state: "error", message: (error as Error).message };
  }
}

function TokenStatus({ check }: { check?: TokenCheck }) {
  if (!check) return null;
  if (check.state === "checking") return <div class="muted">Checking token…</div>;
  if (check.state === "error") return <div class="badge bad">{check.message}</div>;
  if (check.state === "platform")
    return (
      <div>
        <span class="badge ok">Connected</span> <span class="muted">platform token; its permissions are managed in Account Management</span>
      </div>
    );
  return (
    <div>
      <span class="badge ok">Connected</span> <span class="muted">token “{check.name}”</span>
      {check.expires && <span class="muted"> · expires {new Date(check.expires).toLocaleDateString()}</span>}
      {check.missing.length > 0 && (
        <details>
          <summary class="muted">{check.missing.length} scope(s) missing, so some pages will be read-only or empty</summary>
          <ul class="scope-list">
            {check.missing.map((s) => (
              <li key={s}>
                <code>{s}</code>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function EditEnvironment(props: { env: Environment; onClose: () => void; onSave: (env: Environment) => void }) {
  const [env, setEnv] = useState(props.env);
  const [error, setError] = useState("");
  const isNew = !props.env.url;

  const submit = (e: Event) => {
    e.preventDefault();
    try {
      const parsed = parseEnvironmentUrl(env.url);
      if (!env.token.trim()) throw new Error("Paste an API token.");
      props.onSave({ ...env, name: env.name.trim() || parsed.tenantId, url: env.url.trim(), token: env.token.trim() });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Dialog title={isNew ? "Add environment" : `Edit ${props.env.name}`} onClose={props.onClose}>
      <form onSubmit={submit}>
        <label class="field">
          <span>Environment URL or tenant ID</span>
          <input
            required
            autoFocus
            placeholder="abc12345 or https://abc12345.live.dynatrace.com"
            value={env.url}
            onInput={(e) => setEnv({ ...env, url: e.currentTarget.value })}
          />
          <small>SaaS tenant ID, any URL from the Dynatrace UI, or a Managed URL ending in /e/&lt;environment-id&gt;.</small>
        </label>
        <label class="field">
          <span>Name</span>
          <input placeholder="Production" value={env.name} onInput={(e) => setEnv({ ...env, name: e.currentTarget.value })} />
        </label>
        <label class="field">
          <span>API token</span>
          <input
            required
            type="password"
            autoComplete="off"
            placeholder="dt0c01.… or dt0s16.…"
            value={env.token}
            onInput={(e) => setEnv({ ...env, token: e.currentTarget.value })}
          />
          <small>
            A classic access token (<code>dt0c01.…</code>, include <code>apiTokens.read</code> so DMM can list missing scopes) or a platform token (<code>dt0s16.…</code>).
          </small>
        </label>
        {error && <div class="error-box">{error}</div>}
        <div class="actions">
          <button type="button" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" class="primary">
            {isNew ? "Add and test" : "Save and test"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function PassphraseDialog(props: { mode: "remember" | "export"; onClose: () => void; onDone: (passphrase: string) => Promise<void> }) {
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const [busy, run] = useBusy();
  const mismatch = second.length > 0 && first !== second;

  return (
    <Dialog title={props.mode === "remember" ? "Remember on this device" : "Export encrypted file"} onClose={props.onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (first.length < 8 || first !== second) return;
          run(() => props.onDone(first));
        }}
      >
        <p>
          {props.mode === "remember"
            ? "The environment list is encrypted with this passphrase and kept in this browser. Without the passphrase it cannot be opened, by you either."
            : "The file is encrypted with this passphrase. Import it on another device with the same passphrase."}
        </p>
        <label class="field">
          <span>Passphrase (8 characters or more)</span>
          <input type="password" autoFocus autoComplete="new-password" minLength={8} value={first} onInput={(e) => setFirst(e.currentTarget.value)} />
        </label>
        <label class="field">
          <span>Repeat it</span>
          <input type="password" autoComplete="new-password" value={second} onInput={(e) => setSecond(e.currentTarget.value)} />
          {mismatch && <small style={{ color: "var(--danger)" }}>The two do not match.</small>}
        </label>
        <div class="actions">
          <button type="button" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" class="primary" disabled={busy || first.length < 8 || first !== second}>
            {busy ? "Encrypting…" : props.mode === "remember" ? "Remember" : "Export"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
