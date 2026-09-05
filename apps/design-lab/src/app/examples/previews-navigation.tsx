"use client";

import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
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
  Pagination,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationList,
  PaginationNext,
  PaginationPrevious,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarItem,
  SidebarLink,
  SidebarList,
  SidebarNav,
  SidebarSection,
  SidebarSectionLabel,
  Tab,
  TabPanel,
  Tabs,
  TabsList,
} from "@pythia/ui";
import type { CatalogRoute } from "../../catalog";
import { DemoNote, Specimen, SpecimenGrid } from "./specimen";

export function NavigationPreview({ route }: { route: CatalogRoute }) {
  switch (route) {
    case "/components/tabs":
      return (
        <SpecimenGrid>
          <Specimen label="Peer views of synthetic content">
            <Tabs defaultValue="summary">
              <TabsList aria-label="Synthetic evidence views">
                <Tab value="summary">Summary</Tab>
                <Tab value="evidence">Evidence</Tab>
                <Tab value="notes">Notes</Tab>
                <Tab disabled value="history">
                  History
                </Tab>
              </TabsList>
              <TabPanel value="summary">
                <div className="catalog-panel-copy">
                  A fictional summary with no product or performance claim.
                </div>
              </TabPanel>
              <TabPanel value="evidence">
                <div className="catalog-panel-copy">
                  Three labelled synthetic evidence items.
                </div>
              </TabPanel>
              <TabPanel value="notes">
                <div className="catalog-panel-copy">
                  One editable-looking but static synthetic note.
                </div>
              </TabPanel>
              <TabPanel value="history">
                <div className="catalog-panel-copy">
                  Unavailable synthetic history.
                </div>
              </TabPanel>
            </Tabs>
          </Specimen>
        </SpecimenGrid>
      );
    case "/components/breadcrumb":
      return (
        <SpecimenGrid>
          <Specimen label="Application-owned hierarchy">
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink href="#synthetic-root">
                    Synthetic archive
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbEllipsis />
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbLink href="#synthetic-list">
                    Materials
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>Example record</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </Specimen>
        </SpecimenGrid>
      );
    case "/components/pagination":
      return (
        <SpecimenGrid>
          <Specimen label="Linked result pages">
            <Pagination>
              <PaginationList>
                <PaginationItem>
                  <PaginationPrevious href="#synthetic-page-1" />
                </PaginationItem>
                <PaginationItem>
                  <PaginationLink href="#synthetic-page-1">1</PaginationLink>
                </PaginationItem>
                <PaginationItem>
                  <PaginationLink current href="#synthetic-page-2">
                    2
                  </PaginationLink>
                </PaginationItem>
                <PaginationItem>
                  <PaginationLink href="#synthetic-page-3">3</PaginationLink>
                </PaginationItem>
                <PaginationItem>
                  <PaginationEllipsis />
                </PaginationItem>
                <PaginationItem>
                  <PaginationLink href="#synthetic-page-12">12</PaginationLink>
                </PaginationItem>
                <PaginationItem>
                  <PaginationNext href="#synthetic-page-3" />
                </PaginationItem>
              </PaginationList>
            </Pagination>
            <DemoNote>
              Destinations are inert local anchors for this synthetic specimen.
            </DemoNote>
          </Specimen>
        </SpecimenGrid>
      );
    case "/components/navigation-menu":
      return (
        <SpecimenGrid>
          <Specimen label="Grouped destinations">
            <NavigationMenu>
              <NavigationMenuList>
                <NavigationMenuItem value="research">
                  <NavigationMenuTrigger>Research</NavigationMenuTrigger>
                  <NavigationMenuContent>
                    <div className="catalog-menu-links">
                      <NavigationMenuLink href="#synthetic-summary">
                        Synthetic summaries
                      </NavigationMenuLink>
                      <NavigationMenuLink href="#synthetic-methods">
                        Methods
                      </NavigationMenuLink>
                    </div>
                  </NavigationMenuContent>
                </NavigationMenuItem>
                <NavigationMenuItem>
                  <NavigationMenuLink active href="#synthetic-archive">
                    Archive
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
          </Specimen>
        </SpecimenGrid>
      );
    case "/components/sidebar":
      return (
        <SpecimenGrid>
          <Specimen label="Reusable navigation framing">
            <div className="catalog-sidebar-stage">
              <Sidebar>
                <SidebarHeader>
                  <strong>Synthetic workspace</strong>
                </SidebarHeader>
                <SidebarContent>
                  <SidebarNav aria-label="Synthetic workspace">
                    <SidebarSection>
                      <SidebarSectionLabel>Explore</SidebarSectionLabel>
                      <SidebarList>
                        <SidebarItem>
                          <SidebarLink active href="#synthetic-overview">
                            Overview
                          </SidebarLink>
                        </SidebarItem>
                        <SidebarItem>
                          <SidebarLink href="#synthetic-evidence">
                            Evidence
                          </SidebarLink>
                        </SidebarItem>
                        <SidebarItem>
                          <SidebarLink href="#synthetic-notes">
                            Notes
                          </SidebarLink>
                        </SidebarItem>
                      </SidebarList>
                    </SidebarSection>
                  </SidebarNav>
                </SidebarContent>
                <SidebarFooter>Labelled synthetic navigation</SidebarFooter>
              </Sidebar>
              <div className="catalog-panel-copy">
                Content remains app-owned and deliberately non-product-like.
              </div>
            </div>
          </Specimen>
        </SpecimenGrid>
      );
    default:
      throw new Error(`Missing curated navigation preview: ${route}`);
  }
}
