import { useCallback, useEffect, useState } from "react";

export type ColorMode = "light" | "dark";

const STORAGE_KEY = "theme";

/**
 * Light and dark, kept on the <html> element as a `dark` class.
 *
 * HeroUI reads that class, so the whole palette follows from it and no
 * component needs to know which mode is active. The choice is remembered, and
 * until one is made the operating system decides.
 */
export function useColorMode() {
  const [mode, setMode] = useState<ColorMode>(readInitialMode);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", mode === "dark");
    root.style.colorScheme = mode;
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // A browser that refuses storage just forgets the choice.
    }
  }, [mode]);

  // Follow the system only while the user has expressed no preference.
  useEffect(() => {
    if (storedMode()) return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = (e: MediaQueryListEvent) => setMode(e.matches ? "dark" : "light");
    query.addEventListener("change", follow);
    return () => query.removeEventListener("change", follow);
  }, []);

  const toggle = useCallback(
    () => setMode((current) => (current === "dark" ? "light" : "dark")),
    []
  );

  return { mode, setMode, toggle };
}

function storedMode(): ColorMode | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

function readInitialMode(): ColorMode {
  if (typeof window === "undefined") return "light";
  const stored = storedMode();
  if (stored) return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}
