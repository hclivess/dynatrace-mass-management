import { useState } from "preact/hooks";

/** Light, dark, or follow the system. The choice is a per-browser convenience, nothing more. */
export type Theme = "system" | "light" | "dark";
const KEY = "dmm.theme";

function stored(): Theme {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(theme: Theme = stored()): void {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(stored);
  const set = (next: Theme) => {
    try {
      if (next === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      /* storage blocked: still switch for this visit */
    }
    applyTheme(next);
    setTheme(next);
  };
  return [theme, set];
}
