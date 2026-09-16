import { createLocalLayout } from "@/layout/local-layout";

export const DOCK_MIN = 340;
export const DOCK_MAX = 680;

/** Keep the existing browser key and values; no migration or host state needed. */
export const shellLayout = createLocalLayout({
  key: "pythia-desk.shell",
  fields: {
    railCollapsed: { default: false, attribute: "data-desk-rail-collapsed" },
    listOpen: { default: true, attribute: "data-desk-list-open" },
    dockOpen: { default: true, attribute: "data-desk-dock-open" },
    dockWidth: {
      default: 420,
      min: DOCK_MIN,
      max: DOCK_MAX,
      property: "--desk-dock-width",
      unit: "px",
    },
  },
});
export function writeDockWidth(width: number) {
  shellLayout.write({ dockWidth: width });
}
