"use client";

import { SidebarLink } from "@pythia/ui";
import { Bookmark, FileText, Filter, LayoutDashboard } from "lucide-react";

export function LinkStates() {
  return (
    <div
      className="flex flex-col gap-1 rounded-lg border border-border bg-container p-2"
      style={{ width: 240 }}
    >
      <SidebarLink href="#holdings">Holdings</SidebarLink>
      <SidebarLink active href="#screens">
        Screens
      </SidebarLink>
      <SidebarLink href="#watchlists">Watchlists</SidebarLink>
      <SidebarLink href="#filings">Filings</SidebarLink>
    </div>
  );
}

export function WithIcon() {
  return (
    <div
      className="flex flex-col gap-1 rounded-lg border border-border bg-container p-2"
      style={{ width: 240 }}
    >
      <SidebarLink href="#overview">
        <LayoutDashboard aria-hidden="true" size={16} />
        <span>Overview</span>
      </SidebarLink>
      <SidebarLink active href="#screens">
        <Filter aria-hidden="true" size={16} />
        <span>Screens</span>
      </SidebarLink>
      <SidebarLink href="#watchlists">
        <Bookmark aria-hidden="true" size={16} />
        <span>Watchlists</span>
      </SidebarLink>
      <SidebarLink href="#filings">
        <FileText aria-hidden="true" size={16} />
        <span>Filings</span>
      </SidebarLink>
    </div>
  );
}

export function TruncatedLabel() {
  return (
    <div
      className="flex flex-col gap-1 rounded-lg border border-border bg-container p-2"
      style={{ width: 220 }}
    >
      <SidebarLink active href="#chat-smelter">
        <span className="min-w-0 truncate">
          Calder Metals smelter restart economics
        </span>
      </SidebarLink>
      <SidebarLink href="#chat-covenant">
        <span className="min-w-0 truncate">
          Northwind refinancing covenant disclosure
        </span>
      </SidebarLink>
      <SidebarLink href="#chat-coverage">
        <span className="min-w-0 truncate">
          Which interim statements are missing?
        </span>
      </SidebarLink>
    </div>
  );
}

export function WithTrailingCount() {
  return (
    <div
      className="flex flex-col gap-1 rounded-lg border border-border bg-container p-2"
      style={{ width: 240 }}
    >
      <SidebarLink active href="#evidence">
        <span>Evidence</span>
        <span className="ml-auto tabular-nums text-foreground-secondary text-xs">
          238
        </span>
      </SidebarLink>
      <SidebarLink href="#notes">
        <span>Notes</span>
        <span className="ml-auto tabular-nums text-foreground-secondary text-xs">
          12
        </span>
      </SidebarLink>
      <SidebarLink href="#drafts">
        <span>Drafts</span>
        <span className="ml-auto tabular-nums text-foreground-secondary text-xs">
          3
        </span>
      </SidebarLink>
    </div>
  );
}
