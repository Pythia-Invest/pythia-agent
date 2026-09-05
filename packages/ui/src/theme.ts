export const themePreferences = ["light", "dark", "system"] as const;
export const designProfiles = ["public", "product"] as const;

export type ThemePreference = (typeof themePreferences)[number];
export type ResolvedTheme = Exclude<ThemePreference, "system">;
export type DesignProfile = (typeof designProfiles)[number];

export const THEME_STORAGE_KEY = "pythia-theme";

export const DEFAULT_THEME_ROOT_ATTRIBUTES = {
  "data-theme": "light",
  "data-theme-preference": "system",
} as const;

/** Accept browser-owned presentation state only when it matches the enum. */
export function parseThemePreference(value: unknown): ThemePreference | null {
  return typeof value === "string" &&
    themePreferences.includes(value as ThemePreference)
    ? (value as ThemePreference)
    : null;
}

/** Validate a consumer-owned profile control before writing the root attribute. */
export function parseDesignProfile(value: unknown): DesignProfile | null {
  return typeof value === "string" &&
    designProfiles.includes(value as DesignProfile)
    ? (value as DesignProfile)
    : null;
}

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  return preference === "system"
    ? systemPrefersDark
      ? "dark"
      : "light"
    : preference;
}

/**
 * Run this inline in the document head before styles paint. It validates the
 * single persisted preference and writes the resolved theme to the root.
 */
export const THEME_BOOTSTRAP_SCRIPT = `(()=>{const d=document.documentElement;let p="system";try{const s=localStorage.getItem("${THEME_STORAGE_KEY}");if(s==="light"||s==="dark"||s==="system")p=s}catch{}let m=false;try{m=matchMedia("(prefers-color-scheme: dark)").matches}catch{}const t=p==="system"?(m?"dark":"light"):p;d.dataset.theme=t;d.dataset.themePreference=p;d.style.colorScheme=t})();`;
