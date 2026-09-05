"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  parseThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemePreference,
} from "./theme";

export interface ThemePreferenceControl {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  /** Returns false and changes nothing when presentation state is invalid. */
  setPreference: (value: unknown) => boolean;
}

const darkSchemeQuery = "(prefers-color-scheme: dark)";

function applyRootTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  const resolvedTheme = resolveTheme(preference, systemPrefersDark);
  const root = document.documentElement;
  root.dataset.theme = resolvedTheme;
  root.dataset.themePreference = preference;
  root.style.colorScheme = resolvedTheme;
  return resolvedTheme;
}

function readStoredPreference(): ThemePreference {
  try {
    return (
      parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY)) ?? "system"
    );
  } catch {
    return "system";
  }
}

/** Small client-only controller for a consumer-owned theme control. */
export function useThemePreference(): ThemePreferenceControl {
  const [preference, setPreferenceState] = useState<ThemePreference>("system");
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("light");
  const preferenceRef = useRef<ThemePreference>("system");

  useEffect(() => {
    const media = window.matchMedia(darkSchemeQuery);
    const storedPreference = readStoredPreference();
    preferenceRef.current = storedPreference;
    setPreferenceState(storedPreference);
    setResolvedTheme(applyRootTheme(storedPreference, media.matches));

    const handleSystemChange = (event: MediaQueryListEvent) => {
      if (preferenceRef.current === "system") {
        setResolvedTheme(applyRootTheme("system", event.matches));
      }
    };

    media.addEventListener("change", handleSystemChange);
    return () => media.removeEventListener("change", handleSystemChange);
  }, []);

  const setPreference = useCallback((value: unknown): boolean => {
    const nextPreference = parseThemePreference(value);
    if (nextPreference === null) return false;

    preferenceRef.current = nextPreference;
    setPreferenceState(nextPreference);
    setResolvedTheme(
      applyRootTheme(
        nextPreference,
        window.matchMedia(darkSchemeQuery).matches,
      ),
    );
    try {
      localStorage.setItem(THEME_STORAGE_KEY, nextPreference);
    } catch {
      // The root theme still updates when storage is unavailable.
    }
    return true;
  }, []);

  return { preference, resolvedTheme, setPreference };
}
