import { useEffect, useState } from "preact/hooks";
import { demoFetch, isDemo } from "../api/demo";
import { Dynatrace } from "../api/dynatrace";
import { parseEnvironmentUrl } from "../api/environment";
import { loadSaved, loadSession, saveSession, seal, storeSaved, type Environment, type SealedVault } from "./vault";

/**
 * App-wide state: the environment list, which one is current, and whether a saved vault is
 * waiting for its passphrase. One tiny observable instead of a state library.
 */
interface State {
  environments: Environment[];
  currentId: string | null;
  /** Set when an encrypted vault exists in localStorage and has not been opened in this tab. */
  locked: SealedVault | null;
  /** Passphrase of the opened vault, kept in memory only so edits can be re-sealed. */
  passphrase: string | null;
}

type Listener = () => void;
const listeners = new Set<Listener>();
const CURRENT_KEY = "dmm.current";

const session = loadSession();
const saved = loadSaved();
const initial = session ?? [];
const remembered = sessionStorageGet(CURRENT_KEY);
let state: State = {
  environments: initial,
  currentId: initial.some((e) => e.id === remembered) ? remembered : (initial[0]?.id ?? null),
  locked: session ? null : saved,
  passphrase: null,
};

export function getState(): State {
  return state;
}

function set(patch: Partial<State>): void {
  state = { ...state, ...patch };
  if (state.currentId && !state.environments.some((e) => e.id === state.currentId)) state.currentId = null;
  if (!state.currentId && state.environments[0]) state.currentId = state.environments[0].id;
  sessionStorageSet(CURRENT_KEY, state.currentId);
  for (const listener of listeners) listener();
}

export function useAppState(): State {
  const [, force] = useState(0);
  useEffect(() => {
    const listener = () => force((n) => n + 1);
    listeners.add(listener);
    return () => void listeners.delete(listener);
  }, []);
  return state;
}

export async function setEnvironments(environments: Environment[]): Promise<void> {
  saveSession(environments);
  if (state.passphrase) storeSaved(await seal(environments, state.passphrase));
  set({ environments });
}

export function selectEnvironment(id: string): void {
  set({ currentId: id });
}

export function unlocked(environments: Environment[], passphrase: string): void {
  saveSession(environments);
  set({ environments, locked: null, passphrase });
}

export function skipUnlock(): void {
  set({ locked: null });
}

export async function rememberOnDevice(passphrase: string | null): Promise<void> {
  storeSaved(passphrase ? await seal(state.environments, passphrase) : null);
  set({ passphrase });
}

export function isRemembered(): boolean {
  return loadSaved() !== null;
}

// Clients are cheap but keep their identity per environment so components can depend on them.
const clients = new Map<string, { key: string; client: Dynatrace }>();

export function clientFor(env: Environment): Dynatrace {
  const key = `${env.url}\n${env.token}\n${env.readOnly ? "ro" : "rw"}`;
  const cached = clients.get(env.id);
  if (cached?.key === key) return cached.client;
  const { apiRoot } = parseEnvironmentUrl(env.url);
  const client = new Dynatrace(apiRoot, env.token, isDemo(apiRoot) ? demoFetch : undefined, env.readOnly === true);
  clients.set(env.id, { key, client });
  return client;
}

export interface TokenScopes {
  scopes: Set<string>;
  personal: boolean;
}

// One lookup per environment and token. null: unknown (platform token, or the lookup failed), so
// pages just try and report what Dynatrace says.
const scopeLookups = new Map<string, Promise<TokenScopes | null>>();

export function tokenScopes(env: Environment): Promise<TokenScopes | null> {
  const key = `${env.id}\n${env.token}`;
  let lookup = scopeLookups.get(key);
  if (!lookup) {
    lookup = clientFor(env)
      .tokenInfo()
      .then((info) => ("platform" in info ? null : { scopes: new Set(info.scopes), personal: info.personalAccessToken === true }))
      .catch(() => null);
    scopeLookups.set(key, lookup);
  }
  return lookup;
}

export function useTokenScopes(env: Environment | undefined): TokenScopes | null {
  const [result, setResult] = useState<{ key: string; scopes: TokenScopes | null } | null>(null);
  const key = env ? `${env.id}\n${env.token}` : "";
  useEffect(() => {
    if (!env) return;
    let live = true;
    tokenScopes(env).then((scopes) => live && setResult({ key, scopes }));
    return () => void (live = false);
  }, [key]);
  return result?.key === key ? result.scopes : null;
}

export function useCurrent(): { env: Environment; client: Dynatrace } | null {
  const { environments, currentId } = useAppState();
  const env = environments.find((e) => e.id === currentId);
  return env ? { env, client: clientFor(env) } : null;
}

function sessionStorageGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function sessionStorageSet(key: string, value: string | null): void {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    /* storage blocked */
  }
}
