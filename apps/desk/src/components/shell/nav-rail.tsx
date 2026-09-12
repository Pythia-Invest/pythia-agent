"use client";

import {
  cn,
  IconButton,
  PythiaLockup,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarItem,
  SidebarLink,
  SidebarList,
  SidebarNav,
} from "@pythia/ui";
import { PanelLeftClose, PanelLeftOpen, Settings } from "lucide-react";
import Link from "next/link";
import { type Destination, destinations } from "./destinations";

export interface NavRailProps {
  className?: string;
  collapsed: boolean;
  id?: string;
  /** Home is also "start a chat", so the shell decides what focus follows. */
  onNavigateHome: () => void;
  onToggleCollapsed: () => void;
  pathname: string;
}

function RailLink({
  collapsed,
  destination,
  pathname,
}: {
  collapsed: boolean;
  destination: Destination;
  pathname: string;
}) {
  const { href, icon: Icon, label, matches } = destination;
  return (
    <SidebarItem>
      <SidebarLink
        active={matches(pathname)}
        className={cn("gap-2.5 text-body", collapsed && "justify-center px-0")}
        render={<Link href={href} />}
        title={collapsed ? label : undefined}
      >
        <Icon
          aria-hidden="true"
          className="size-[18px] flex-none stroke-[1.6]"
        />
        <span className={cn("min-w-0 flex-1 truncate", collapsed && "sr-only")}>
          {label}
        </span>
      </SidebarLink>
    </SidebarItem>
  );
}

/**
 * Application navigation: identity, destinations, settings.
 *
 * Deliberately separate from the chat list. The rail names where you are in
 * the app; the list beside it holds the conversations inside Chat, and can be
 * hidden without losing navigation.
 */
export function NavRail({
  className,
  collapsed,
  id,
  onNavigateHome,
  onToggleCollapsed,
  pathname,
}: NavRailProps) {
  const settingsActive = pathname.startsWith("/settings");
  return (
    <Sidebar
      aria-label="Desk navigation"
      className={cn(
        "motion-standard h-dvh min-w-0 bg-canvas transition-[width]",
        collapsed ? "w-15" : "w-56",
        className,
      )}
      id={id}
    >
      <SidebarHeader
        className={cn(
          "flex min-h-14 flex-none items-center border-b-0 py-0",
          collapsed ? "justify-center px-0" : "gap-1 pr-2 pl-4",
        )}
      >
        {collapsed ? null : (
          <Link
            aria-label="Pythia home"
            // PythiaLockup sizes itself in em, so this font-size is the
            // lockup's width control, not type in the shell's scale.
            className="flex min-w-0 items-center rounded-control text-[1rem] focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
            href="/"
            onClick={(event) => {
              event.preventDefault();
              onNavigateHome();
            }}
          >
            <PythiaLockup decorative variant="full" />
          </Link>
        )}
        <IconButton
          className={cn(!collapsed && "ms-auto")}
          label={collapsed ? "Expand navigation" : "Collapse navigation"}
          onClick={onToggleCollapsed}
          size="sm"
        >
          {/* The matched pair, not one glyph rotated: rotating the close
              variant would mirror the panel edge to the wrong side. */}
          {collapsed ? (
            <PanelLeftOpen className="stroke-[1.6]" />
          ) : (
            <PanelLeftClose className="stroke-[1.6]" />
          )}
        </IconButton>
      </SidebarHeader>
      <SidebarContent className="p-2">
        <SidebarNav aria-label="Desk sections">
          <SidebarList className="gap-0.5">
            {destinations.map((destination) => (
              <RailLink
                collapsed={collapsed}
                destination={destination}
                key={destination.id}
                pathname={pathname}
              />
            ))}
          </SidebarList>
        </SidebarNav>
      </SidebarContent>
      <SidebarFooter
        className={cn(
          "flex flex-none items-center gap-1 border-t-0 p-2",
          collapsed && "flex-col",
        )}
      >
        <SidebarLink
          active={settingsActive}
          className={cn(
            "gap-2.5 text-body",
            collapsed ? "justify-center px-0" : "flex-1",
          )}
          render={<Link href="/settings" />}
          title={collapsed ? "Settings" : undefined}
        >
          <Settings
            aria-hidden="true"
            className="size-[18px] flex-none stroke-[1.6]"
          />
          <span className={cn("min-w-0 truncate", collapsed && "sr-only")}>
            Settings
          </span>
        </SidebarLink>
      </SidebarFooter>
    </Sidebar>
  );
}
