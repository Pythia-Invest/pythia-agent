import type { InstrumentRead, InstrumentWidgetOptions } from "@pythia/ui";

/** Narrow display snapshot; never provider credentials or an execution handle. */
export type WidgetSnapshot = InstrumentRead & {
  source: string;
  detail: string;
  retrievedAt?: string | undefined;
};

export type WidgetTheme = {
  foreground: string;
  background: string;
  up: string;
  down: string;
};

export type WidgetAppearance = {
  theme: "light" | "dark";
  profile: "product" | "public";
};

/** Data and settings remain host-owned. Local React state can control display. */
export type WidgetProps<
  TData = WidgetSnapshot,
  TSettings = Record<string, unknown>,
> = {
  data: TData;
  options: InstrumentWidgetOptions;
  settings: TSettings;
  /** Selected native presentation id. One feature module may render several
   * declared views; only the owning feature interprets this value. */
  presentation?: string | undefined;
  theme: WidgetTheme;
  timeZone: string;
  locale: string;
  /** Additive v1 field; older HTML renderers can keep using theme colors. */
  appearance?: WidgetAppearance | undefined;
};

export type WidgetRenderMessage<
  TData = WidgetSnapshot,
  TSettings = Record<string, unknown>,
> = WidgetProps<TData, TSettings> & { type: "pythia:render"; version: 1 };

/** Unversioned notifications remain accepted for existing authored HTML. */
export type WidgetFrameMessage =
  | { type: "pythia:ready" | "pythia:error"; version?: 1 | undefined }
  | { type: "pythia:height"; version?: 1 | undefined; height: number };
