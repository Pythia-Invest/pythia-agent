"use client";

import {
  Sidebar,
  SidebarButton,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarItem,
  SidebarLink,
  SidebarList,
  SidebarNav,
  SidebarSection,
  SidebarSectionLabel,
} from "@pythia/ui";
import {
  Bookmark,
  FileText,
  Filter,
  LayoutDashboard,
  NotebookText,
  SquarePen,
  Table2,
} from "lucide-react";

export function WorkspaceNavigation() {
  return (
    <div className="flex bg-canvas" style={{ height: 480, width: 272 }}>
      <Sidebar className="flex-1">
        <SidebarHeader>
          <div className="flex flex-col gap-1">
            <span className="font-semibold text-foreground">Pythia</span>
            <span className="text-foreground-secondary text-xs">
              Local research desk
            </span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarNav aria-label="Research workspace">
            <SidebarSection>
              <SidebarSectionLabel>Research</SidebarSectionLabel>
              <SidebarList>
                <SidebarItem>
                  <SidebarLink active href="#overview">
                    Overview
                  </SidebarLink>
                </SidebarItem>
                <SidebarItem>
                  <SidebarLink href="#holdings">Holdings</SidebarLink>
                </SidebarItem>
                <SidebarItem>
                  <SidebarLink href="#screens">Screens</SidebarLink>
                </SidebarItem>
                <SidebarItem>
                  <SidebarLink href="#watchlists">Watchlists</SidebarLink>
                </SidebarItem>
              </SidebarList>
            </SidebarSection>
            <SidebarSection>
              <SidebarSectionLabel>Library</SidebarSectionLabel>
              <SidebarList>
                <SidebarItem>
                  <SidebarLink href="#filings">Filings</SidebarLink>
                </SidebarItem>
                <SidebarItem>
                  <SidebarLink href="#evidence">Evidence</SidebarLink>
                </SidebarItem>
                <SidebarItem>
                  <SidebarLink href="#notes">Notes</SidebarLink>
                </SidebarItem>
              </SidebarList>
            </SidebarSection>
          </SidebarNav>
        </SidebarContent>
        <SidebarFooter>
          <span className="text-foreground-secondary text-xs">
            238 filings archived locally
          </span>
        </SidebarFooter>
      </Sidebar>
    </div>
  );
}

export function ChatHistory() {
  return (
    <div className="flex bg-canvas" style={{ height: 480, width: 272 }}>
      <Sidebar className="flex-1">
        <SidebarHeader>
          <SidebarButton>
            <SquarePen aria-hidden="true" size={16} />
            <span>New chat</span>
          </SidebarButton>
        </SidebarHeader>
        <SidebarContent>
          <SidebarNav aria-label="Recent chats">
            <SidebarSection>
              <SidebarSectionLabel>Pinned</SidebarSectionLabel>
              <SidebarList>
                <SidebarItem className="min-w-0">
                  <SidebarLink href="#chat-covenant">
                    <span className="min-w-0 truncate">
                      Northwind refinancing covenant
                    </span>
                  </SidebarLink>
                </SidebarItem>
              </SidebarList>
            </SidebarSection>
            <SidebarSection>
              <SidebarSectionLabel>Today</SidebarSectionLabel>
              <SidebarList>
                <SidebarItem className="min-w-0">
                  <SidebarLink active href="#chat-smelter">
                    <span className="min-w-0 truncate">
                      Calder Metals smelter restart economics
                    </span>
                  </SidebarLink>
                </SidebarItem>
                <SidebarItem className="min-w-0">
                  <SidebarLink href="#chat-margin">
                    <span className="min-w-0 truncate">
                      Kestrel margin bridge, FY 2028
                    </span>
                  </SidebarLink>
                </SidebarItem>
              </SidebarList>
            </SidebarSection>
            <SidebarSection>
              <SidebarSectionLabel>Earlier</SidebarSectionLabel>
              <SidebarList>
                <SidebarItem className="min-w-0">
                  <SidebarLink href="#chat-screen">
                    <span className="min-w-0 truncate">
                      Quality screen thresholds
                    </span>
                  </SidebarLink>
                </SidebarItem>
                <SidebarItem className="min-w-0">
                  <SidebarLink href="#chat-coverage">
                    <span className="min-w-0 truncate">
                      Which interim statements are missing?
                    </span>
                  </SidebarLink>
                </SidebarItem>
              </SidebarList>
            </SidebarSection>
          </SidebarNav>
        </SidebarContent>
        <SidebarFooter>
          <span className="text-foreground-secondary text-xs">
            Conversations stay on this device
          </span>
        </SidebarFooter>
      </Sidebar>
    </div>
  );
}

export function WithIcons() {
  return (
    <div className="flex bg-canvas" style={{ height: 340, width: 272 }}>
      <Sidebar className="flex-1">
        <SidebarHeader>
          <span className="font-semibold text-foreground">Evidence archive</span>
        </SidebarHeader>
        <SidebarContent>
          <SidebarNav aria-label="Evidence archive">
            <SidebarSection>
              <SidebarSectionLabel>Browse</SidebarSectionLabel>
              <SidebarList>
                <SidebarItem>
                  <SidebarLink href="#dashboard">
                    <LayoutDashboard aria-hidden="true" size={16} />
                    <span>Dashboard</span>
                  </SidebarLink>
                </SidebarItem>
                <SidebarItem>
                  <SidebarLink active href="#documents">
                    <FileText aria-hidden="true" size={16} />
                    <span>Filings</span>
                  </SidebarLink>
                </SidebarItem>
                <SidebarItem>
                  <SidebarLink href="#tables">
                    <Table2 aria-hidden="true" size={16} />
                    <span>Extracted tables</span>
                  </SidebarLink>
                </SidebarItem>
                <SidebarItem>
                  <SidebarLink href="#annotations">
                    <NotebookText aria-hidden="true" size={16} />
                    <span>Annotations</span>
                  </SidebarLink>
                </SidebarItem>
              </SidebarList>
            </SidebarSection>
          </SidebarNav>
        </SidebarContent>
      </Sidebar>
    </div>
  );
}

export function CollapsedRail() {
  return (
    <div className="flex bg-canvas" style={{ height: 320, width: 64 }}>
      <Sidebar style={{ minWidth: 0, width: 64 }}>
        <SidebarHeader className="p-2">
          <span className="flex justify-center font-semibold text-foreground">
            P
          </span>
        </SidebarHeader>
        <SidebarContent>
          <SidebarNav aria-label="Research workspace, collapsed">
            <SidebarList>
              <SidebarItem>
                <SidebarLink
                  active
                  aria-label="Overview"
                  className="justify-center"
                  href="#overview"
                >
                  <LayoutDashboard aria-hidden="true" size={16} />
                </SidebarLink>
              </SidebarItem>
              <SidebarItem>
                <SidebarLink
                  aria-label="Screens"
                  className="justify-center"
                  href="#screens"
                >
                  <Filter aria-hidden="true" size={16} />
                </SidebarLink>
              </SidebarItem>
              <SidebarItem>
                <SidebarLink
                  aria-label="Watchlists"
                  className="justify-center"
                  href="#watchlists"
                >
                  <Bookmark aria-hidden="true" size={16} />
                </SidebarLink>
              </SidebarItem>
              <SidebarItem>
                <SidebarLink
                  aria-label="Filings"
                  className="justify-center"
                  href="#filings"
                >
                  <FileText aria-hidden="true" size={16} />
                </SidebarLink>
              </SidebarItem>
            </SidebarList>
          </SidebarNav>
        </SidebarContent>
      </Sidebar>
    </div>
  );
}
