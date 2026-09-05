import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "../src/navigation/breadcrumb";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "../src/navigation/navigation-menu";
import {
  Pagination,
  PaginationItem,
  PaginationLink,
  PaginationList,
} from "../src/navigation/pagination";
import {
  Sidebar,
  SidebarItem,
  SidebarLink,
  SidebarList,
  SidebarNav,
} from "../src/navigation/sidebar";
import { Tab, TabPanel, Tabs, TabsList } from "../src/navigation/tabs";

describe("navigation controls", () => {
  it("isolates interactive navigation from server-compatible helpers", async () => {
    for (const file of ["tabs.tsx", "navigation-menu.tsx"] as const) {
      const source = await readFile(
        new URL(`../src/navigation/${file}`, import.meta.url),
        "utf8",
      );
      expect(source.startsWith('"use client";')).toBe(true);
    }

    for (const file of [
      "breadcrumb.tsx",
      "pagination.tsx",
      "sidebar.tsx",
      "index.ts",
    ] as const) {
      const source = await readFile(
        new URL(`../src/navigation/${file}`, import.meta.url),
        "utf8",
      );
      expect(source.startsWith('"use client";')).toBe(false);
    }
  });

  it("preserves Base UI tab selection and keyboard structure", () => {
    const markup = renderToStaticMarkup(
      <Tabs defaultValue="overview">
        <TabsList>
          <Tab value="overview">Overview</Tab>
          <Tab value="evidence">Evidence</Tab>
        </TabsList>
        <TabPanel value="overview">Summary</TabPanel>
        <TabPanel value="evidence">Sources</TabPanel>
      </Tabs>,
    );

    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('role="tab"');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain('data-active=""');
    expect(markup).toContain('role="tabpanel"');
    expect(markup).toContain("pythia-tabs__tab");
  });

  it("adds only current-page translation to breadcrumb and pagination links", () => {
    const markup = renderToStaticMarkup(
      <>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/library">Library</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Selection</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <Pagination>
          <PaginationList>
            <PaginationItem>
              <PaginationLink href="?page=1">1</PaginationLink>
            </PaginationItem>
            <PaginationItem>
              <PaginationLink current href="?page=2">
                2
              </PaginationLink>
            </PaginationItem>
          </PaginationList>
        </Pagination>
      </>,
    );

    expect(markup).toContain('aria-label="Breadcrumb"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('aria-label="Pagination"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('data-current=""');
    expect(markup).toContain('href="?page=2"');
  });

  it("retains Base UI navigation-menu anatomy and active-link state", () => {
    const markup = renderToStaticMarkup(
      <NavigationMenu>
        <NavigationMenuList>
          <NavigationMenuItem value="research">
            <NavigationMenuTrigger>Research</NavigationMenuTrigger>
          </NavigationMenuItem>
          <NavigationMenuItem>
            <NavigationMenuLink active href="/archive">
              Archive
            </NavigationMenuLink>
          </NavigationMenuItem>
        </NavigationMenuList>
      </NavigationMenu>,
    );

    expect(markup).toContain("<nav");
    expect(markup).toContain("<ul");
    expect(markup).toContain("<li");
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('data-base-ui-navigation-menu-trigger=""');
    expect(markup).toContain('data-active=""');
    expect(markup).toContain("pythia-navigation-menu__trigger");
    expect(markup).toContain("pythia-navigation-menu__link");
  });

  it("defaults navigation-menu popup alignment to the trigger start edge", async () => {
    const source = await readFile(
      new URL("../src/navigation/navigation-menu.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain('align = "start"');
    expect(source).toContain("align={align}");
  });

  it("translates sidebar active state without owning routes", () => {
    const markup = renderToStaticMarkup(
      <Sidebar>
        <SidebarNav aria-label="Workspace">
          <SidebarList>
            <SidebarItem>
              <SidebarLink active href="/workups">
                Workups
              </SidebarLink>
            </SidebarItem>
          </SidebarList>
        </SidebarNav>
      </Sidebar>,
    );

    expect(markup).toContain("<aside");
    expect(markup).toContain('aria-label="Workspace"');
    expect(markup).toContain('href="/workups"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('data-active=""');
  });

  it("separates transient open state from persistent navigation", async () => {
    const css = await readFile(
      new URL("../src/navigation/navigation.css", import.meta.url),
      "utf8",
    );

    expect(css).toContain("var(--py-interaction-active)");
    expect(css).toContain("var(--py-action-primary-background)");
    expect(css).toContain("var(--py-interaction-hover)");
    expect(css).toMatch(
      /\.pythia-tabs__tab\[data-active\]\s*\{[^}]*background:\s*transparent;[^}]*border-color:\s*var\(--py-action-primary-background\)/,
    );
    expect(css).not.toMatch(
      /\.pythia-tabs__tab\[data-active\]\s*\{[^}]*background:\s*var\(--py-interaction-active\)/,
    );
    expect(css).toMatch(
      /\.pythia-navigation-menu__trigger\[data-popup-open\]\s*\{[^}]*background:\s*var\(--py-interaction-active\)/,
    );
    const openTriggerStyle = css.match(
      /\.pythia-navigation-menu__trigger\[data-popup-open\]\s*\{[^}]*\}/,
    )?.[0];
    expect(openTriggerStyle).toContain("--py-interaction-active");
    for (const selector of [
      ".pythia-navigation-menu__link[data-active]",
      ".pythia-sidebar__link[data-active]",
    ]) {
      const lowEmphasisStyle = css.match(
        new RegExp(
          `${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{[^}]*\\}`,
        ),
      )?.[0];
      expect(lowEmphasisStyle).toContain("--py-interaction-active");
      expect(lowEmphasisStyle).toContain("font-weight: 600");
      expect(lowEmphasisStyle).not.toContain("--py-action-primary-background");
      expect(lowEmphasisStyle).not.toContain("box-shadow");
    }
    const paginationStyle = css.match(
      /\.pythia-pagination__link\[data-current\]\s*\{[^}]*\}/,
    )?.[0];
    expect(paginationStyle).toContain("--py-interaction-active");
    expect(paginationStyle).toContain("border-color: var(--py-border-default)");
    expect(paginationStyle).toContain("font-weight: 600");
    expect(css).not.toMatch(/--py-selection-[\w-]+/);
    expect(css).not.toContain("--py-signal-");
    expect(css).not.toContain("--py-color-");
  });
});
