"use client";

import {
  Badge,
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
import Link from "next/link";
import { useState } from "react";
import { useRepairs } from "@/client/repairs";
import {
  CapabilitySettings,
  ModelSettings,
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
    id: "models",
    label: "Models",
    description: "Native model authentication on this device.",
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
  {
    id: "repairs",
    label: "Repairs",
    description:
      "Issues Pythia could not settle on its own. The agent normally fixes these.",
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
  const open = useRepairs().open.length;
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
        className="hidden w-52 flex-none flex-col items-stretch gap-0.5 border-border/50 border-r border-b-0 p-2 sm:flex"
      >
        {sections.map((item) => (
          <Tab
            key={item.id}
            value={item.id}
            className="min-h-control rounded-control border-0 px-2 text-start text-body data-active:bg-interaction-active data-active:font-medium"
          >
            {item.label}
            {/* The count is repeated in the panel; the tab keeps its name. */}
            {item.id === "repairs" && open ? (
              <Badge
                tone="warning"
                className="ms-2"
                aria-hidden="true"
              >
                {open}
              </Badge>
            ) : null}
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
                {item.id === "models" ? <ModelSettings /> : null}
                {item.id === "capabilities" ? <CapabilitySettings /> : null}
                {item.id === "updates" ? <UpdateSettings /> : null}
                {item.id === "repairs" ? (
                  <SettingRow
                    control={
                      <Link
                        href="/settings/repairs"
                        className="font-medium text-body text-foreground underline-offset-2 hover:underline"
                      >
                        Open repairs
                      </Link>
                    }
                    description={
                      open
                        ? `${open} open ${open === 1 ? "issue" : "issues"}.`
                        : "Nothing needs attention."
                    }
                    label="Open issues"
                  />
                ) : null}
              </div>
            </TabPanel>
          ))}
        </div>
      </div>
    </Tabs>
  );
}
