/** A bounded description of an app surface, never arbitrary DOM/form state. */
export type DeskView = {
  route: string;
  title: string;
  file?: {
    path: string;
    /** Derived by the server; browser-supplied values are ignored. */
    hostPath?: string;
    heading?: string;
    selection?: string;
    revision?: string;
    page?: number;
  };
};
export type DeskViewPublication = {
  tab_id: string;
  view_reference: string;
  sequence: number;
  view: DeskView;
};
export const DESK_VIEW_TTL_MS = 60_000;
export const DESK_VIEW_HEARTBEAT_MS = 20_000;
