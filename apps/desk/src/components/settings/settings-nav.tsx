"use client";

import { cn } from "@pythia/ui";
import { ChevronRight } from "lucide-react";
import { Fragment } from "react";
import { settingsHref } from "./settings-address";
import { type SettingsSection, settingsSections } from "./sections";

const item =
  "motion-fast flex flex-none items-center gap-2 rounded-control text-body no-underline transition-colors hover:bg-interaction-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2";

function Attention() {
  return (
    <span
      role="img"
      aria-label="Needs attention"
      className="ms-auto size-1.5 flex-none rounded-pill bg-current text-warning"
    />
  );
}

function Link({
  page,
  current,
  className,
  onPage,
  children,
}: {
  page: string;
  current: boolean;
  className: string;
  onPage: (page: string) => void;
  children: React.ReactNode;
}) {
  return (
    <a
      href={settingsHref(page)}
      aria-current={current ? "page" : undefined}
      onClick={(event) => {
        event.preventDefault();
        onPage(page);
      }}
      className={className}
    >
      {children}
    </a>
  );
}

/**
 * The sidebar tree, after Hermes Desktop's: sections, the current one open
 * to its pages, and spacers between groups. Choosing a section opens its
 * first page.
 */
export function DesktopNav({
  page,
  attention,
  onPage,
}: {
  page: string;
  attention: ReadonlySet<string>;
  onPage: (page: string) => void;
}) {
  const open = page.split("/")[0];
  return (
    <nav
      aria-label="Settings sections"
      data-slot="settings-navigation"
      className="flex flex-col gap-0.5"
    >
      {settingsSections.map((section) => {
        const Icon = section.icon;
        const expanded = section.id === open && section.pages.length > 1;
        const first = section.pages[0]?.id ?? section.id;
        return (
          <Fragment key={section.id}>
            {section.gapBefore ? (
              <span aria-hidden="true" className="h-3" />
            ) : null}
            <Link
              page={first}
              current={section.id === open && section.pages.length === 1}
              onPage={onPage}
              className={cn(
                item,
                "h-8 px-2 text-foreground-secondary",
                section.id === open &&
                  "bg-interaction-active font-medium text-foreground",
              )}
            >
              <Icon
                aria-hidden="true"
                className="size-4 flex-none stroke-[1.6]"
              />
              <span className="truncate">{section.title}</span>
              {attention.has(section.id) ? <Attention /> : null}
            </Link>
            {expanded ? (
              <div className="ml-3.5 flex flex-col gap-0.5 border-border border-l py-0.5 pl-1.5">
                {section.pages.map((child) => (
                  <Link
                    key={child.id}
                    page={child.id}
                    current={child.id === page}
                    onPage={onPage}
                    className={cn(
                      item,
                      "h-7 px-2 text-foreground-secondary aria-[current=page]:font-medium aria-[current=page]:text-foreground",
                    )}
                  >
                    <span className="truncate">{child.title}</span>
                  </Link>
                ))}
              </div>
            ) : null}
          </Fragment>
        );
      })}
    </nav>
  );
}

function PhoneGroup({
  section,
  attention,
  onPage,
}: {
  section: SettingsSection;
  attention: boolean;
  onPage: (page: string) => void;
}) {
  const Icon = section.icon;
  const single = section.pages.length === 1;
  return (
    <div className="flex flex-col gap-1.5">
      {single ? null : (
        <p className="m-0 flex items-center gap-2 px-1 text-foreground-secondary text-xs">
          <Icon aria-hidden="true" className="size-3.5 stroke-[1.6]" />
          {section.title}
        </p>
      )}
      <div className="flex flex-col divide-y divide-border overflow-hidden rounded-container border border-border bg-raised">
        {section.pages.map((child) => {
          const ChildIcon = single ? Icon : child.icon;
          return (
            <Link
              key={child.id}
              page={child.id}
              current={false}
              onPage={onPage}
              className={cn(item, "h-12 rounded-none px-3.5 text-foreground")}
            >
              <ChildIcon
                aria-hidden="true"
                className="size-4 flex-none stroke-[1.6] text-foreground-secondary"
              />
              <span className="truncate">
                {single ? section.title : child.title}
              </span>
              {attention && single ? <Attention /> : null}
              <ChevronRight
                aria-hidden="true"
                className={cn(
                  "size-4 flex-none text-foreground-secondary",
                  !(attention && single) && "ms-auto",
                )}
              />
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/** On a phone the list is the page: every page as a row, grouped by section. */
export function PhoneNav({
  attention,
  onPage,
}: {
  attention: ReadonlySet<string>;
  onPage: (page: string) => void;
}) {
  return (
    <nav
      aria-label="Settings sections"
      data-slot="settings-navigation"
      className="flex flex-col gap-5"
    >
      {settingsSections.map((section) => (
        <PhoneGroup
          key={section.id}
          section={section}
          attention={attention.has(section.id)}
          onPage={onPage}
        />
      ))}
    </nav>
  );
}
