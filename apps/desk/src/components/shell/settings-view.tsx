"use client";

import {
  Tab,
  TabPanel,
  Tabs,
  TabsList,
  Select,
  SelectItem,
  SelectList,
  SelectPopup,
  SelectPortal,
  SelectPositioner,
  SelectTrigger,
  SelectValue,
  useThemePreference,
} from "@pythia/ui";
import { useState } from "react";
import {
  CapabilitySettings,
  DataSourceSettings,
  SettingRow,
  UpdateSettings,
} from "./settings-controls";

const sections = [
  {
    id: "appearance",
    label: "Appearance",
    description: "How the desk looks on this device.",
  },
  {
    id: "data-sources",
    label: "Data sources",
    description: "Readiness and optional service credentials on this device.",
  },
  {
    id: "capabilities",
    label: "Skills and tools",
    description: "Manage the native Hermes capabilities available to Pythia.",
  },
  {
    id: "updates",
    label: "Updates",
    description: "Check the installed channel. Desk never applies an update.",
  },
] as const;

/**
 * Following the device is the default, so it is a real option rather than the
 * absence of one — picking Light or Dark is an override that stops tracking
 * the system, and the reader can come back to "System" to undo it.
 */
const themeOptions = {
  system: "System",
  light: "Light",
  dark: "Dark",
} as const;

function ThemeChoice() {
  const theme = useThemePreference();
  return (
    <Select
      items={themeOptions}
      onValueChange={(value) => theme.setPreference(value)}
      value={theme.preference}
    >
      <SelectTrigger aria-label="Theme">
        <SelectValue />
      </SelectTrigger>
      <SelectPortal>
        <SelectPositioner>
          <SelectPopup>
            <SelectList>
              {Object.entries(themeOptions).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectList>
          </SelectPopup>
        </SelectPositioner>
      </SelectPortal>
    </Select>
  );
}

/** Existing Settings layout, with native controls in their corresponding panels. */
export function SettingsView() {
  const [section, setSection] = useState("appearance");
  return (
    <Tabs
      orientation="vertical"
      value={section}
      onValueChange={(value) => setSection(String(value))}
      className="flex min-h-0 flex-1 overflow-y-auto"
      data-slot="settings-view"
    >
      <TabsList
        aria-label="Settings sections"
        className="hidden w-52 flex-none flex-col items-stretch gap-0.5 border-border border-r border-b-0 p-2 sm:flex"
      >
        {sections.map((item) => (
          <Tab
            key={item.id}
            value={item.id}
            className="min-h-control rounded-control border-0 px-2 text-start text-body data-active:bg-interaction-active data-active:font-medium"
          >
            {item.label}
          </Tab>
        ))}
      </TabsList>
      <div className="min-w-0 flex-1 px-gutter py-6">
        <div className="max-w-measure">
          <div className="mb-4 sm:hidden">
            <Select
              value={section}
              onValueChange={(value) => {
                if (value) setSection(value);
              }}
              items={Object.fromEntries(
                sections.map((item) => [item.id, item.label]),
              )}
            >
              <SelectTrigger aria-label="Settings section">
                <SelectValue />
              </SelectTrigger>
              <SelectPortal>
                <SelectPositioner>
                  <SelectPopup>
                    <SelectList>
                      {sections.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectList>
                  </SelectPopup>
                </SelectPositioner>
              </SelectPortal>
            </Select>
          </div>
          {sections.map((item) => (
            <TabPanel key={item.id} value={item.id} className="py-0">
              <h2 className="m-0 font-semibold text-[1.125rem] text-foreground leading-tight">
                {item.label}
              </h2>
              <p className="mt-1 mb-0 text-body text-foreground-secondary leading-ui">
                {item.description}
              </p>
              <div className="mt-4">
                {item.id === "appearance" ? (
                  <SettingRow
                    control={<ThemeChoice />}
                    description="Follow this device, or pin the desk to light or dark."
                    label="Theme"
                  />
                ) : null}
                {item.id === "data-sources" ? <DataSourceSettings /> : null}
                {item.id === "capabilities" ? <CapabilitySettings /> : null}
                {item.id === "updates" ? <UpdateSettings /> : null}
              </div>
            </TabPanel>
          ))}
        </div>
      </div>
    </Tabs>
  );
}
