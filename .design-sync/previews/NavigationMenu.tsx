"use client";

import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuPopup,
  NavigationMenuPortal,
  NavigationMenuPositioner,
  NavigationMenuTrigger,
  NavigationMenuViewport,
} from "@pythia/ui";

export function ResearchMenubar() {
  return (
    <div className="bg-canvas p-3">
      <NavigationMenu aria-label="Research desk">
        <NavigationMenuList>
          <NavigationMenuItem value="research">
            <NavigationMenuTrigger>Research</NavigationMenuTrigger>
            <NavigationMenuContent>
              <div className="flex flex-col gap-1" style={{ width: 240 }}>
                <NavigationMenuLink href="#holdings">
                  Holdings
                </NavigationMenuLink>
                <NavigationMenuLink href="#screens">Screens</NavigationMenuLink>
                <NavigationMenuLink href="#watchlists">
                  Watchlists
                </NavigationMenuLink>
              </div>
            </NavigationMenuContent>
          </NavigationMenuItem>
          <NavigationMenuItem value="library">
            <NavigationMenuTrigger>Library</NavigationMenuTrigger>
            <NavigationMenuContent>
              <div className="flex flex-col gap-1" style={{ width: 240 }}>
                <NavigationMenuLink href="#filings">Filings</NavigationMenuLink>
                <NavigationMenuLink href="#evidence">
                  Evidence
                </NavigationMenuLink>
                <NavigationMenuLink href="#notes">Notes</NavigationMenuLink>
              </div>
            </NavigationMenuContent>
          </NavigationMenuItem>
          <NavigationMenuItem>
            <NavigationMenuLink active href="#overview">
              Overview
            </NavigationMenuLink>
          </NavigationMenuItem>
        </NavigationMenuList>
        <NavigationMenuPortal>
          <NavigationMenuPositioner>
            <NavigationMenuPopup>
              <NavigationMenuViewport />
            </NavigationMenuPopup>
          </NavigationMenuPositioner>
        </NavigationMenuPortal>
      </NavigationMenu>
    </div>
  );
}

export function LinkOnlyBar() {
  return (
    <div className="bg-canvas p-3">
      <NavigationMenu aria-label="Issuer sections">
        <NavigationMenuList>
          <NavigationMenuItem>
            <NavigationMenuLink href="#summary">Summary</NavigationMenuLink>
          </NavigationMenuItem>
          <NavigationMenuItem>
            <NavigationMenuLink active href="#evidence">
              Evidence
            </NavigationMenuLink>
          </NavigationMenuItem>
          <NavigationMenuItem>
            <NavigationMenuLink href="#filings">Filings</NavigationMenuLink>
          </NavigationMenuItem>
          <NavigationMenuItem>
            <NavigationMenuLink href="#notes">Notes</NavigationMenuLink>
          </NavigationMenuItem>
        </NavigationMenuList>
      </NavigationMenu>
    </div>
  );
}

export function InPageHeader() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-border border-b bg-canvas px-4 py-3">
      <span className="font-semibold text-foreground">Pythia</span>
      <NavigationMenu aria-label="Primary">
        <NavigationMenuList>
          <NavigationMenuItem>
            <NavigationMenuLink active href="#desk">
              Desk
            </NavigationMenuLink>
          </NavigationMenuItem>
          <NavigationMenuItem value="research">
            <NavigationMenuTrigger>Research</NavigationMenuTrigger>
            <NavigationMenuContent>
              <div className="flex flex-col gap-1" style={{ width: 240 }}>
                <NavigationMenuLink href="#holdings">
                  Holdings
                </NavigationMenuLink>
                <NavigationMenuLink href="#screens">Screens</NavigationMenuLink>
              </div>
            </NavigationMenuContent>
          </NavigationMenuItem>
          <NavigationMenuItem>
            <NavigationMenuLink href="#settings">Settings</NavigationMenuLink>
          </NavigationMenuItem>
        </NavigationMenuList>
        <NavigationMenuPortal>
          <NavigationMenuPositioner>
            <NavigationMenuPopup>
              <NavigationMenuViewport />
            </NavigationMenuPopup>
          </NavigationMenuPositioner>
        </NavigationMenuPortal>
      </NavigationMenu>
    </div>
  );
}
