import { useEffect, useState } from "preact/hooks";
import { tryDemo } from "./api/try";
import { PAGES, type PageDef } from "./pages";
import { Environments } from "./pages/Environments";
import { selectEnvironment, skipUnlock, unlocked, useAppState, useCurrent, useTokenScopes, type TokenScopes } from "./store/state";
import { unseal } from "./store/vault";
import { ConfirmHost, Toasts, useBusy } from "./ui/feedback";
import { useRoute } from "./ui/hooks";
import { PageHead } from "./ui/Page";
import { Icon } from "./ui/icons";
import { useTheme, type Theme } from "./ui/theme";

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

  // #/try/playground and #/try/sample are links visitors get from the README.
  useEffect(() => {
    const demo = path.match(/^\/try\/(playground|sample)$/)?.[1] as "playground" | "sample" | undefined;
    if (demo) void tryDemo(demo);
  }, [path]);

  const scopes = useTokenScopes(current?.env);
  const page = PAGES.find((p) => p.path === path);
  const showEnvironments = path === "/environments" || environments.length === 0 || (!page && path !== "/");
  const active = showEnvironments ? null : (page ?? PAGES[0]);
  const groups = groupBy(PAGES, (p) => p.group);

  return (
    <div class="app">
      <nav class={`sidebar${menuOpen ? " open" : ""}`} aria-label="Main" onClick={() => setMenuOpen(false)}>
        <a class="brand" href="#/">
          <span class="brand-mark" aria-hidden="true" />
          <span class="brand-text">
            <b>DMM</b>
            <span>Mass Management</span>
          </span>
        </a>
        <div class="nav-group">
          <a href="#/environments" aria-current={showEnvironments ? "page" : undefined}>
            <Icon name="environments" />
            Environments
          </a>
        </div>
        {environments.length > 0 &&
          [...groups].map(([group, pages]) => (
            <div class="nav-group" key={group}>
              <span>{group}</span>
              {pages.map((p) => {
                const missing = missingScopes(p, scopes);
                return (
                  <a
                    key={p.path}
                    href={`#${p.path}`}
                    class={missing ? "locked" : undefined}
                    title={missing ? `This token has no ${missing.join(" or ")} scope` : undefined}
                    aria-current={active?.path === p.path ? "page" : undefined}
                  >
                    <Icon name={p.icon} />
                    {p.label}
                  </a>
                );
              })}
            </div>
          ))}
        <p class="sidebar-foot">
          {__APP_VERSION__} · <a href="https://github.com/hclivess/dynatrace-mass-management">GitHub</a>
          <br />
          Not affiliated with Dynatrace.
        </p>
      </nav>
      <div class="workspace">
        <header class="topbar">
          <button type="button" class="menu-toggle icon-button" onClick={() => setMenuOpen(!menuOpen)} aria-expanded={menuOpen} aria-label="Menu">
            <Icon name="menu" />
          </button>
          {environments.length > 0 && (
            <label class="env-switch">
              <span class="env-dot" aria-hidden="true" />
              <select aria-label="Environment" value={currentId ?? ""} onChange={(e) => selectEnvironment(e.currentTarget.value)}>
                {environments.map((env) => (
                  <option key={env.id} value={env.id}>
                    {env.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {current?.env.readOnly && <span class="badge warn">read-only demo</span>}
          <span class="spacer" />
          <ThemeSwitch />
        </header>
        <main>
          {showEnvironments || !active ? (
            <Environments />
          ) : !active.global && current && missingScopes(active, scopes) ? (
            <MissingScope page={active} missing={missingScopes(active, scopes)!} personal={scopes!.personal} />
          ) : active.global || current ? (
            // Keyed by environment so switching tenants remounts the page and drops stale data.
            <active.component key={active.global ? "all" : current!.env.id} />
          ) : (
            <Environments />
          )}
        </main>
      </div>
    </div>
  );
}

/** The scopes a page needs that the token lacks, or null when it has one of them or we cannot tell. */
function missingScopes(page: PageDef, scopes: TokenScopes | null): string[] | null {
  if (!page.scopes || !scopes) return null;
  return page.scopes.some((s) => scopes.scopes.has(s)) ? null : page.scopes;
}

// Dynatrace offers personal access tokens only the API v2 scopes; these older ones need an
// environment access token.
const NOT_FOR_PERSONAL_TOKENS = new Set(["ReadConfig", "WriteConfig", "auditLogs.read", "logs.read", "ReadSyntheticData", "ExternalSyntheticIntegration", "DataExport"]);

function MissingScope({ page, missing, personal }: { page: PageDef; missing: string[]; personal: boolean }) {
  const needsAccessToken = personal && missing.every((s) => NOT_FOR_PERSONAL_TOKENS.has(s));
  return (
    <>
      <PageHead title={page.label} />
      <div class="notice">
        <p style={{ margin: "0 0 0.5rem" }}>
          This page needs the{" "}
          {missing.map((scope, i) => (
            <span key={scope}>
              {i > 0 && " or "}
              <code>{scope}</code>
            </span>
          ))}{" "}
          scope, and the token for this environment does not have it.
        </p>
        {needsAccessToken ? (
          <p class="muted" style={{ margin: 0 }}>
            It is a personal access token, and Dynatrace does not offer that scope for personal tokens, so ticking every box will not add it. An environment
            access token (created by an admin under <em>Access tokens</em>) can have it.
          </p>
        ) : (
          <p class="muted" style={{ margin: 0 }}>Add the scope to the token in Dynatrace, then reload.</p>
        )}
      </div>
    </>
  );
}

function ThemeSwitch() {
  const [theme, setTheme] = useTheme();
  const options: [Theme, string][] = [
    ["light", "Light"],
    ["dark", "Dark"],
    ["system", "System"],
  ];
  return (
    <div class="segmented" role="radiogroup" aria-label="Theme">
      {options.map(([value, label]) => (
        <button key={value} type="button" role="radio" aria-checked={theme === value} title={label} aria-label={label} onClick={() => setTheme(value)}>
          <Icon name={value === "light" ? "sun" : value === "dark" ? "moon" : "system"} size={16} />
        </button>
      ))}
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
        <div class="brand"><span class="brand-mark" aria-hidden="true" /><span class="brand-text"><b>DMM</b><span>Mass Management</span></span></div>
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
