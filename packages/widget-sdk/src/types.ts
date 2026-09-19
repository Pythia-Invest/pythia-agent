import type { InstrumentRead, InstrumentWidgetOptions } from "@pythia/ui";

export type WidgetAppearance = {
  theme: "light" | "dark";
  profile: "product" | "public";
};

/** Data and settings remain host-owned. Local React state can control display. */
export type WidgetProps<
  TData = InstrumentRead,
  TSettings = Record<string, unknown>,
> = {
  data: TData;
  options: InstrumentWidgetOptions;
  settings: TSettings;
  /** Selected native presentation id. One feature module may render several
   * declared views; only the owning feature interprets this value. */
  presentation?: string | undefined;
  timeZone: string;
  locale: string;
  /** Resolved host appearance for renderers that need more than inherited CSS. */
  appearance?: WidgetAppearance | undefined;
};
