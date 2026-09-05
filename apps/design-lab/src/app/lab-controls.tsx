"use client";

import {
  designProfiles,
  parseDesignProfile,
  themePreferences,
  type DesignProfile,
  useThemePreference,
} from "@pythia/ui";
import { useEffect, useState } from "react";

const viewportOptions = ["wide", "tablet", "phone"] as const;
type LabViewport = (typeof viewportOptions)[number];

interface LabControlsProps {
  onViewportChange: (viewport: LabViewport) => void;
  viewport: LabViewport;
}

export function applyDesignProfile(
  root: Pick<HTMLElement, "dataset">,
  value: unknown,
): DesignProfile | null {
  const nextProfile = parseDesignProfile(value);
  if (nextProfile === null) return null;
  root.dataset.pythiaProfile = nextProfile;
  return nextProfile;
}

export function LabControls({ onViewportChange, viewport }: LabControlsProps) {
  const theme = useThemePreference();
  const [profile, setProfile] = useState<DesignProfile>("public");

  useEffect(() => {
    const rootProfile = parseDesignProfile(
      document.documentElement.dataset.pythiaProfile,
    );
    if (rootProfile !== null) setProfile(rootProfile);
  }, []);

  function selectProfile(value: unknown) {
    const nextProfile = applyDesignProfile(document.documentElement, value);
    if (nextProfile === null) return;
    setProfile(nextProfile);
  }

  return (
    <div className="lab-controls">
      <fieldset className="lab-control">
        <legend>Theme</legend>
        <div className="lab-segments">
          {themePreferences.map((preference) => (
            <button
              aria-pressed={theme.preference === preference}
              key={preference}
              onClick={() => theme.setPreference(preference)}
              type="button"
            >
              {preference[0]?.toUpperCase()}
              {preference.slice(1)}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="lab-control">
        <legend>Design profile</legend>
        <div className="lab-segments">
          {designProfiles.map((option) => (
            <button
              aria-pressed={profile === option}
              key={option}
              onClick={() => selectProfile(option)}
              type="button"
            >
              {option[0]?.toUpperCase()}
              {option.slice(1)}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="lab-control lab-control-viewport">
        <legend>Preview width</legend>
        <div className="lab-segments">
          {viewportOptions.map((option) => (
            <button
              aria-pressed={viewport === option}
              key={option}
              onClick={() => onViewportChange(option)}
              type="button"
            >
              {option[0]?.toUpperCase()}
              {option.slice(1)}
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

export type { LabViewport };
