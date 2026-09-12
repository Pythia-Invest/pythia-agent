import { Button, DropdownMenu, IconButton } from "@pythia/ui";
import { Check, ChevronDown, Ellipsis, ExternalLink } from "lucide-react";

/**
 * DropdownMenu is the same anatomy as Menu, named for the case where a visible
 * trigger reveals the menu. Open stories use `defaultOpen` with
 * `modal={false}`; the reveal transition itself is not capturable.
 *
 * `outline-0` on the open popups is a capture concession, not a pattern to
 * copy: Base UI moves focus into the popup on open, and with no prior user
 * interaction the browser treats that as keyboard focus and paints the focus
 * ring. A real pointer-opened menu has no ring.
 */

export function SavedViews() {
  return (
    <div className="bg-canvas p-6 rounded-lg">
      <div className="flex items-center gap-3 rounded-lg border border-border bg-raised px-4 py-3 max-w-lg">
        <div className="flex flex-col gap-1 min-w-0">
          <span className="font-semibold text-foreground text-sm">
            European industrials
          </span>
          <span className="text-foreground-secondary text-xs">
            18 issuers · saved view
          </span>
        </div>
        <DropdownMenu.Root defaultOpen modal={false}>
          <DropdownMenu.Trigger
            render={
              <Button className="ml-auto" size="sm" variant="secondary">
                Saved views
                <ChevronDown aria-hidden="true" size={16} />
              </Button>
            }
          />
          <DropdownMenu.Portal>
            <DropdownMenu.Positioner align="start" side="bottom">
              <DropdownMenu.Popup className="outline-0">
                <DropdownMenu.Group>
                  <DropdownMenu.GroupLabel>Your views</DropdownMenu.GroupLabel>
                  <DropdownMenu.RadioGroup defaultValue="industrials">
                    <DropdownMenu.RadioItem value="industrials">
                      <DropdownMenu.RadioItemIndicator>
                        <Check aria-hidden="true" size={16} />
                      </DropdownMenu.RadioItemIndicator>
                      European industrials
                    </DropdownMenu.RadioItem>
                    <DropdownMenu.RadioItem value="quality">
                      <DropdownMenu.RadioItemIndicator>
                        <Check aria-hidden="true" size={16} />
                      </DropdownMenu.RadioItemIndicator>
                      Quality compounders
                    </DropdownMenu.RadioItem>
                    <DropdownMenu.RadioItem value="watch">
                      <DropdownMenu.RadioItemIndicator>
                        <Check aria-hidden="true" size={16} />
                      </DropdownMenu.RadioItemIndicator>
                      Watchlist candidates
                    </DropdownMenu.RadioItem>
                  </DropdownMenu.RadioGroup>
                </DropdownMenu.Group>
                <DropdownMenu.Separator />
                <DropdownMenu.Item>Save current filters…</DropdownMenu.Item>
                <DropdownMenu.Item disabled>
                  Share view (workspace only)
                </DropdownMenu.Item>
              </DropdownMenu.Popup>
            </DropdownMenu.Positioner>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </div>
  );
}

export function AlignedToEnd() {
  return (
    <div className="bg-canvas p-6 rounded-lg">
      <div className="flex flex-col gap-3 max-w-lg">
        <span className="text-foreground-secondary text-xs">
          Aligned to the trigger&rsquo;s end edge, so a right-hand row action
          opens back into the row instead of off the table.
        </span>
        <div className="flex items-center gap-3 rounded-lg border border-border bg-raised px-4 py-3">
          <span className="font-semibold text-foreground text-sm">
            Sable Point Energy
          </span>
          <DropdownMenu.Root defaultOpen modal={false}>
            <DropdownMenu.Trigger
              render={
                <IconButton
                  className="ml-auto"
                  label="More actions"
                  size="sm"
                  variant="ghost"
                >
                  <Ellipsis aria-hidden="true" size={16} />
                </IconButton>
              }
            />
            <DropdownMenu.Portal>
              <DropdownMenu.Positioner align="end" side="bottom">
                <DropdownMenu.Popup className="outline-0">
                  <DropdownMenu.Item>Pin to dashboard</DropdownMenu.Item>
                  <DropdownMenu.Item>Add coverage note</DropdownMenu.Item>
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item className="text-error">
                    Drop coverage
                  </DropdownMenu.Item>
                </DropdownMenu.Popup>
              </DropdownMenu.Positioner>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>
    </div>
  );
}

export function LinkItems() {
  return (
    <div className="bg-canvas p-6 rounded-lg">
      <div className="flex items-center gap-3 rounded-lg border border-border bg-raised px-4 py-3 max-w-lg">
        <span className="font-semibold text-foreground text-sm">
          Bramley Foods — FY 2028
        </span>
        <DropdownMenu.Root defaultOpen modal={false}>
          <DropdownMenu.Trigger
            render={
              <Button className="ml-auto" size="sm" variant="secondary">
                Sources
                <ChevronDown aria-hidden="true" size={16} />
              </Button>
            }
          />
          <DropdownMenu.Portal>
            <DropdownMenu.Positioner align="end" side="bottom">
              <DropdownMenu.Popup className="outline-0">
                <DropdownMenu.Group>
                  <DropdownMenu.GroupLabel>
                    Filed documents
                  </DropdownMenu.GroupLabel>
                  <DropdownMenu.LinkItem href="#annual-report">
                    <ExternalLink aria-hidden="true" size={16} />
                    Annual report 2028
                  </DropdownMenu.LinkItem>
                  <DropdownMenu.LinkItem href="#half-year">
                    <ExternalLink aria-hidden="true" size={16} />
                    Half-year statement
                  </DropdownMenu.LinkItem>
                </DropdownMenu.Group>
                <DropdownMenu.Separator />
                <DropdownMenu.Item>Copy citation</DropdownMenu.Item>
              </DropdownMenu.Popup>
            </DropdownMenu.Positioner>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </div>
  );
}

export function ClosedInHeader() {
  return (
    <div className="bg-canvas p-6 rounded-lg">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-raised px-4 py-3 max-w-xl">
        <div className="flex flex-col gap-1 min-w-0">
          <span className="font-semibold text-foreground text-sm">
            Portfolio review
          </span>
          <span className="text-foreground-secondary text-xs">
            Draft · 12 holdings outstanding
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm">Publish review</Button>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger
              render={
                <Button size="sm" variant="secondary">
                  Review actions
                  <ChevronDown aria-hidden="true" size={16} />
                </Button>
              }
            />
            <DropdownMenu.Portal>
              <DropdownMenu.Positioner align="end">
                <DropdownMenu.Popup>
                  <DropdownMenu.Item>Duplicate review</DropdownMenu.Item>
                  <DropdownMenu.Item>Archive review</DropdownMenu.Item>
                </DropdownMenu.Popup>
              </DropdownMenu.Positioner>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>
    </div>
  );
}
