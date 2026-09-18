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
import { useState } from "react";
import { type Destination, destinations } from "./destinations";

export interface NavRailProps {
  className?: string;
  persistent?: boolean;
  id?: string;
  /** Home is also "start a chat", so the shell decides what focus follows. */
  onNavigateHome: () => void;
  onToggleCollapsed: () => void;
  pathname: string;
}

function RailLink({
  persistent,
  destination,
  pathname,
}: {
  persistent?: boolean;
  destination: Destination;
  pathname: string;
}) {
  const { href, icon: Icon, label, matches } = destination;
  return (
    <SidebarItem>
      <SidebarLink
        active={matches(pathname)}
        className={cn(
          "gap-2.5 text-body",
          persistent &&
            "[[data-desk-rail-collapsed=true]_&]:justify-center [[data-desk-rail-collapsed=true]_&]:px-0",
        )}
        aria-label={label}
        render={<Link href={href} />}
        title={label}
      >
        <Icon
          aria-hidden="true"
          className="size-[18px] flex-none stroke-[1.6]"
        />
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            persistent && "[[data-desk-rail-collapsed=true]_&]:sr-only",
          )}
        >
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
  persistent,
  id,
  onNavigateHome,
  onToggleCollapsed,
  pathname,
}: NavRailProps) {
  const [animate, setAnimate] = useState(false);
  const toggle = () => {
    setAnimate(true);
    onToggleCollapsed();
  };
  const settingsActive = pathname.startsWith("/settings");
  return (
    <div
      data-slot="desk-navigation-frame"
      className={cn(
        "motion-standard flex h-dvh w-50 min-w-0 flex-col dark:[&>[data-slot=sidebar]]:border-r dark:[&>[data-slot=sidebar]]:bg-raised",
        animate && "transition-[width]",
        persistent && "[[data-desk-rail-collapsed=true]_&]:w-15",
        className,
      )}
    >
      <Sidebar
        aria-label="Desk navigation"
        className="h-full min-h-0 w-full min-w-0 flex-1 border-border border-r-0 bg-canvas"
        data-theme="dark"
        id={id}
      >
        <SidebarHeader
          className={cn(
            "flex min-h-14 flex-none items-center border-b-0 py-0",
            "gap-1 pr-2 pl-4",
            persistent &&
              "[[data-desk-rail-collapsed=true]_&]:justify-center [[data-desk-rail-collapsed=true]_&]:px-0",
          )}
        >
          <Link
            aria-label="Pythia home"
            // PythiaLockup sizes itself in em, so this font-size is the
            // lockup's width control, not type in the shell's scale.
            className={cn(
              "flex min-w-0 items-center rounded-control text-[1rem] focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2",
              persistent && "[[data-desk-rail-collapsed=true]_&]:hidden",
            )}
            href="/"
            onClick={(event) => {
              event.preventDefault();
              onNavigateHome();
            }}
          >
            <PythiaLockup decorative variant="full" />
          </Link>
          <IconButton
            className={cn(
              "ms-auto",
              persistent && "[[data-desk-rail-collapsed=true]_&]:hidden",
            )}
            label="Collapse navigation"
            onClick={toggle}
            size="sm"
          >
            <PanelLeftClose className="stroke-[1.6]" />
          </IconButton>
          {persistent ? (
            <IconButton
              className="hidden [[data-desk-rail-collapsed=true]_&]:inline-flex"
              label="Expand navigation"
              onClick={toggle}
              size="sm"
            >
              <PanelLeftOpen className="stroke-[1.6]" />
            </IconButton>
          ) : null}
        </SidebarHeader>
        <SidebarContent className="p-2">
          <SidebarNav aria-label="Desk sections">
            <SidebarList className="gap-0.5">
              {destinations.map((destination) => (
                <RailLink
                  persistent={Boolean(persistent)}
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
            persistent && "[[data-desk-rail-collapsed=true]_&]:flex-col",
          )}
        >
          <SidebarLink
            active={settingsActive}
            className={cn(
              "gap-2.5 text-body",
              "flex-1",
              persistent &&
                "[[data-desk-rail-collapsed=true]_&]:justify-center [[data-desk-rail-collapsed=true]_&]:px-0",
            )}
            render={<Link href="/settings" />}
            title="Settings"
            aria-label="Settings"
          >
            <Settings
              aria-hidden="true"
              className="size-[18px] flex-none stroke-[1.6]"
            />
            <span
              className={cn(
                "min-w-0 truncate",
                persistent && "[[data-desk-rail-collapsed=true]_&]:sr-only",
              )}
            >
              Settings
            </span>
          </SidebarLink>
        </SidebarFooter>
      </Sidebar>
    </div>
  );
}
