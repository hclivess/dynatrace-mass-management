import { useState } from "preact/hooks";
import { PAGES, type PageDef } from "./pages";
import { Environments } from "./pages/Environments";
import { selectEnvironment, skipUnlock, unlocked, useAppState, useCurrent } from "./store/state";
import { unseal } from "./store/vault";
import { ConfirmHost, Toasts, useBusy } from "./ui/feedback";
import { useRoute } from "./ui/hooks";

export function App() {
  const { locked } = useAppState();
  return (
    <>
      {locked ? <Unlock /> : <Shell />}
      <ConfirmHost />
      <Toasts />
    </>
  );
}

function Shell() {
  const { environments, currentId } = useAppState();
  const current = useCurrent();
  const { path } = useRoute();
  const [menuOpen, setMenuOpen] = useState(false);

  const page = PAGES.find((p) => p.path === path);
  const showEnvironments = path === "/environments" || environments.length === 0 || (!page && path !== "/");
  const active = showEnvironments ? null : (page ?? PAGES[0]);
  const groups = groupBy(PAGES, (p) => p.group);

  return (
    <div class="app">
      <nav class={`sidebar${menuOpen ? " open" : ""}`} aria-label="Main" onClick={() => setMenuOpen(false)}>
        <a class="brand" href="#/">
          <b>
            DMM<small>{__APP_VERSION__}</small>
          </b>
          <span>Dynatrace Mass Management</span>
        </a>
        {environments.length > 0 && (
          <div class="env-switch" onClick={(e) => e.stopPropagation()}>
            <select aria-label="Environment" value={currentId ?? ""} onChange={(e) => selectEnvironment(e.currentTarget.value)}>
              {environments.map((env) => (
                <option key={env.id} value={env.id}>
                  {env.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div class="nav-group">
          <a href="#/environments" aria-current={showEnvironments ? "page" : undefined}>
            Environments
          </a>
        </div>
        {environments.length > 0 &&
          [...groups].map(([group, pages]) => (
            <div class="nav-group" key={group}>
              <span>{group}</span>
              {pages.map((p) => (
                <a key={p.path} href={`#${p.path}`} aria-current={active?.path === p.path ? "page" : undefined}>
                  {p.label}
                </a>
              ))}
            </div>
          ))}
      </nav>
      <main>
        <button type="button" class="menu-toggle" onClick={() => setMenuOpen(!menuOpen)} aria-expanded={menuOpen}>
          ☰ Menu
        </button>
        {showEnvironments || !active ? (
          <Environments />
        ) : active.global || current ? (
          // Keyed by environment so switching tenants remounts the page and drops stale data.
          <active.component key={active.global ? "all" : current!.env.id} />
        ) : (
          <Environments />
        )}
      </main>
    </div>
  );
}

function Unlock() {
  const { locked } = useAppState();
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState("");
  const [busy, run] = useBusy();

  return (
    <div class="center">
      <form
        class="card"
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          run(async () => {
            try {
              unlocked(await unseal(locked!, passphrase), passphrase);
            } catch (err) {
              setError((err as Error).message);
            }
          });
        }}
      >
        <h1>DMM</h1>
        <p class="muted">Your environments are saved on this device, encrypted. Enter the passphrase to open them.</p>
        <label class="field">
          <span>Passphrase</span>
          <input type="password" autoFocus autoComplete="current-password" value={passphrase} onInput={(e) => setPassphrase(e.currentTarget.value)} />
        </label>
        {error && <div class="error-box">{error}</div>}
        <div class="actions">
          <button type="button" onClick={skipUnlock}>
            Start empty
          </button>
          <button type="submit" class="primary" disabled={busy || !passphrase}>
            {busy ? "Opening…" : "Open"}
          </button>
        </div>
      </form>
    </div>
  );
}

function groupBy(pages: PageDef[], key: (p: PageDef) => string): Map<string, PageDef[]> {
  const out = new Map<string, PageDef[]>();
  for (const p of pages) out.set(key(p), [...(out.get(key(p)) ?? []), p]);
  return out;
}
