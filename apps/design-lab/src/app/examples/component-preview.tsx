"use client";

import type { CatalogEntry } from "../../catalog";
import { ActionsPreview } from "./previews-actions";
import { CalendarPreview } from "./previews-calendar";
import { DataDisplayPreview } from "./previews-data-display";
import { DisclosurePreview } from "./previews-disclosure";
import { FeedbackPreview } from "./previews-feedback";
import { FormsPreview } from "./previews-forms";
import { LayoutPreview } from "./previews-layout";
import { NavigationPreview } from "./previews-navigation";
import { OverlaysPreview } from "./previews-overlays";
import { SelectionPreview } from "./previews-selection";
import { SemanticsPreview } from "./previews-semantics";

export function ComponentPreview({ entry }: { entry: CatalogEntry }) {
  switch (entry.category) {
    case "actions":
      return <ActionsPreview route={entry.route} />;
    case "forms":
      return <FormsPreview route={entry.route} />;
    case "calendar":
      return <CalendarPreview route={entry.route} />;
    case "selection":
      return <SelectionPreview route={entry.route} />;
    case "navigation":
      return <NavigationPreview route={entry.route} />;
    case "overlays":
      return <OverlaysPreview route={entry.route} />;
    case "disclosure":
      return <DisclosurePreview route={entry.route} />;
    case "feedback":
      return <FeedbackPreview route={entry.route} />;
    case "data-display":
      return <DataDisplayPreview route={entry.route} />;
    case "layout":
      return <LayoutPreview route={entry.route} />;
    case "semantics":
      return <SemanticsPreview route={entry.route} />;
  }
}
