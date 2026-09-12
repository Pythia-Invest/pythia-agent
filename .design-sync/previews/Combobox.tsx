import {
  Combobox,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxInput,
  ComboboxInputGroup,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxPortal,
  ComboboxPositioner,
  ComboboxTrigger,
} from "@pythia/ui";

const issuers = [
  "Northwind Grid Utilities",
  "Calder Metals",
  "Kestrel Logistics",
  "Aldergrove Water",
  "Meridian Foods",
  "Vantage Bioscience",
] as const;

type Issuer = (typeof issuers)[number];

/** The popup portals to `document.body`, so every story shows the closed control. */
export function Default() {
  return (
    <div className="w-full max-w-xs">
      <Combobox defaultValue="Northwind Grid Utilities" items={issuers}>
        <ComboboxInputGroup className="w-full">
          <ComboboxInput
            aria-label="Issuer"
            placeholder="Search covered issuers…"
          />
          <ComboboxTrigger />
        </ComboboxInputGroup>
        <ComboboxPortal>
          <ComboboxPositioner>
            <ComboboxPopup>
              <ComboboxEmpty>No issuer matches that name.</ComboboxEmpty>
              <ComboboxList>
                {(issuer: Issuer) => (
                  <ComboboxItem key={issuer} value={issuer}>
                    {issuer}
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxPopup>
          </ComboboxPositioner>
        </ComboboxPortal>
      </Combobox>
    </div>
  );
}

export function Placeholder() {
  return (
    <div className="w-full max-w-xs">
      <Combobox items={issuers}>
        <ComboboxInputGroup className="w-full">
          <ComboboxInput
            aria-label="Issuer"
            placeholder="Search covered issuers…"
          />
          <ComboboxTrigger />
        </ComboboxInputGroup>
        <ComboboxPortal>
          <ComboboxPositioner>
            <ComboboxPopup>
              <ComboboxEmpty>No issuer matches that name.</ComboboxEmpty>
              <ComboboxList>
                {(issuer: Issuer) => (
                  <ComboboxItem key={issuer} value={issuer}>
                    {issuer}
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxPopup>
          </ComboboxPositioner>
        </ComboboxPortal>
      </Combobox>
    </div>
  );
}

export function Disabled() {
  return (
    <div className="w-full max-w-xs">
      <Combobox defaultValue="Calder Metals" disabled items={issuers}>
        <ComboboxInputGroup className="w-full">
          <ComboboxInput aria-label="Issuer" />
          <ComboboxTrigger />
        </ComboboxInputGroup>
        <ComboboxPortal>
          <ComboboxPositioner>
            <ComboboxPopup>
              <ComboboxList>
                {(issuer: Issuer) => (
                  <ComboboxItem key={issuer} value={issuer}>
                    {issuer}
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxPopup>
          </ComboboxPositioner>
        </ComboboxPortal>
      </Combobox>
    </div>
  );
}

/** Grouped options plus a compact list, composed as a labelled screener field. */
export function GroupedOptions() {
  return (
    <div className="flex w-full max-w-xs flex-col gap-2">
      <span className="font-medium text-foreground-secondary text-xs">
        Screen universe
      </span>
      <Combobox defaultValue="Utilities" items={["Utilities", "Industrials"]}>
        <ComboboxInputGroup className="w-full">
          <ComboboxInput
            aria-label="Screen universe"
            placeholder="Filter sectors and lists…"
          />
          <ComboboxTrigger />
        </ComboboxInputGroup>
        <ComboboxPortal>
          <ComboboxPositioner>
            <ComboboxPopup>
              <ComboboxEmpty>Nothing matches that filter.</ComboboxEmpty>
              <ComboboxList density="compact">
                <ComboboxGroup>
                  <ComboboxGroupLabel>Sectors</ComboboxGroupLabel>
                  <ComboboxItem value="Utilities">Utilities</ComboboxItem>
                  <ComboboxItem value="Industrials">Industrials</ComboboxItem>
                </ComboboxGroup>
                <ComboboxGroup>
                  <ComboboxGroupLabel>Saved lists</ComboboxGroupLabel>
                  <ComboboxItem value="European compounders">
                    European compounders
                  </ComboboxItem>
                  <ComboboxItem disabled value="Imported broker list">
                    Imported broker list (not connected)
                  </ComboboxItem>
                </ComboboxGroup>
              </ComboboxList>
            </ComboboxPopup>
          </ComboboxPositioner>
        </ComboboxPortal>
      </Combobox>
      <span className="text-foreground-secondary text-xs leading-relaxed">
        Synthetic coverage: 38 issuers with filings through FY 2028.
      </span>
    </div>
  );
}
