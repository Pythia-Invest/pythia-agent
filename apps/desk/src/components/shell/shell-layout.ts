/**
 * Where the shell's panels sit, kept in this browser.
 *
 * None of it belongs to Hermes: it records how this person arranged the desk
 * on this device, so a read that fails or a value that has gone stale simply
 * falls back to the defaults rather than surfacing an error.
 */

const SHELL_STORAGE_KEY = "pythia-desk.shell";

/** Device-local shell layout; losing it just restores the defaults. */
export type ShellLayout = {
  railCollapsed: boolean;
  listOpen: boolean;
  dockOpen: boolean;
  /** Docked-panel width in pixels, within the design's 340–680 range. */
  dockWidth: number;
};

export const DOCK_MIN = 340;
export const DOCK_MAX = 680;

export const defaultLayout: ShellLayout = {
  railCollapsed: false,
  listOpen: true,
  dockOpen: true,
  dockWidth: 420,
};

export function readLayout(): ShellLayout {
  try {
    const raw = localStorage.getItem(SHELL_STORAGE_KEY);
    if (!raw) return defaultLayout;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return defaultLayout;
    const { railCollapsed, listOpen, dockOpen, dockWidth } =
      parsed as Partial<ShellLayout>;
    return {
      railCollapsed:
        typeof railCollapsed === "boolean"
          ? railCollapsed
          : defaultLayout.railCollapsed,
      listOpen:
        typeof listOpen === "boolean" ? listOpen : defaultLayout.listOpen,
      dockOpen:
        typeof dockOpen === "boolean" ? dockOpen : defaultLayout.dockOpen,
      dockWidth:
        typeof dockWidth === "number" && Number.isFinite(dockWidth)
          ? Math.min(DOCK_MAX, Math.max(DOCK_MIN, dockWidth))
          : defaultLayout.dockWidth,
    };
  } catch {
    return defaultLayout;
  }
}

export function writeLayout(layout: ShellLayout) {
  try {
    localStorage.setItem(SHELL_STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Layout is a browser-local convenience; losing it is acceptable.
  }
}

/**
 * Records the docked panel's width on its own.
 *
 * It is written on every pointer move during a resize, so it reads the stored
 * layout rather than taking one from a React render — no component has to hold
 * the live width, and nothing re-renders mid-drag.
 */
export function writeDockWidth(width: number) {
  writeLayout({ ...readLayout(), dockWidth: width });
}
