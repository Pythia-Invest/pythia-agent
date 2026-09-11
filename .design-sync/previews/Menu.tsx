import { Button, IconButton, Menu } from "@pythia/ui";
import {
  ArrowUpRight,
  Check,
  Download,
  Ellipsis,
  FileText,
  Trash2,
} from "lucide-react";

/**
 * A menu portals its popup to `document.body`, so the open stories are
 * rendered statically with `defaultOpen` and `modal={false}`. Highlight and
 * open/close transitions are pointer-driven and are not captured.
 *
 * `outline-0` on the open popups is a capture concession, not a pattern to
 * copy: Base UI moves focus into the popup on open, and with no prior user
 * interaction the browser treats that as keyboard focus and paints the focus
 * ring. A real pointer-opened menu has no ring.
 */

export function RowActions() {
  return (
    <div className="bg-canvas p-6 rounded-lg">
      <div className="flex items-center gap-4 rounded-lg border border-border bg-raised px-4 py-3 max-w-lg">
        <div className="flex flex-col gap-1 min-w-0">
          <span className="font-semibold text-foreground text-sm">
            Calder Metals
          </span>
          <span className="text-foreground-secondary text-xs">
            Basic materials · 2.9% weight · reviewed 4 Feb 2029
          </span>
        </div>
        <span className="ml-auto font-semibold tabular-nums text-success">
          +6.4%
        </span>
        <Menu.Root defaultOpen modal={false}>
          <Menu.Trigger
            render={
              <IconButton label="Holding actions" size="sm" variant="ghost">
                <Ellipsis aria-hidden="true" size={16} />
              </IconButton>
            }
          />
          <Menu.Portal>
            <Menu.Positioner align="end" side="bottom">
              <Menu.Popup className="outline-0">
                <Menu.Group>
                  <Menu.GroupLabel>Research</Menu.GroupLabel>
                  <Menu.Item>
                    <FileText aria-hidden="true" size={16} />
                    Open thesis
                  </Menu.Item>
                  <Menu.Item>
                    <ArrowUpRight aria-hidden="true" size={16} />
                    Compare with peers
                  </Menu.Item>
                </Menu.Group>
                <Menu.Separator />
                <Menu.Group>
                  <Menu.GroupLabel>Position</Menu.GroupLabel>
                  <Menu.Item>
                    <Download aria-hidden="true" size={16} />
                    Export transactions
                  </Menu.Item>
                  <Menu.Item disabled>Rebalance (needs a plan)</Menu.Item>
                </Menu.Group>
                <Menu.Separator />
                <Menu.Item className="text-error">
                  <Trash2 aria-hidden="true" size={16} />
                  Remove from portfolio
                </Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </div>
    </div>
  );
}

export function ChoiceItems() {
  return (
    <div className="bg-canvas p-6 rounded-lg">
      <div className="flex items-center gap-3 rounded-lg border border-border bg-raised px-4 py-3 max-w-lg">
        <span className="font-semibold text-foreground text-sm">
          Screen results
        </span>
        <Menu.Root defaultOpen modal={false}>
          <Menu.Trigger
            render={
              <Button className="ml-auto" size="sm" variant="secondary">
                Table options
              </Button>
            }
          />
          <Menu.Portal>
            <Menu.Positioner align="end" side="bottom">
              <Menu.Popup className="outline-0">
                <Menu.Group>
                  <Menu.GroupLabel>Columns</Menu.GroupLabel>
                  <Menu.CheckboxItem defaultChecked>
                    <Menu.CheckboxItemIndicator>
                      <Check aria-hidden="true" size={16} />
                    </Menu.CheckboxItemIndicator>
                    Free cash flow yield
                  </Menu.CheckboxItem>
                  <Menu.CheckboxItem defaultChecked>
                    <Menu.CheckboxItemIndicator>
                      <Check aria-hidden="true" size={16} />
                    </Menu.CheckboxItemIndicator>
                    Net debt / EBITDA
                  </Menu.CheckboxItem>
                  <Menu.CheckboxItem>
                    <Menu.CheckboxItemIndicator>
                      <Check aria-hidden="true" size={16} />
                    </Menu.CheckboxItemIndicator>
                    Insider ownership
                  </Menu.CheckboxItem>
                </Menu.Group>
                <Menu.Separator />
                <Menu.Group>
                  <Menu.GroupLabel>Sort by</Menu.GroupLabel>
                  <Menu.RadioGroup defaultValue="quality">
                    <Menu.RadioItem value="quality">
                      <Menu.RadioItemIndicator>
                        <Check aria-hidden="true" size={16} />
                      </Menu.RadioItemIndicator>
                      Quality score
                    </Menu.RadioItem>
                    <Menu.RadioItem value="weight">
                      <Menu.RadioItemIndicator>
                        <Check aria-hidden="true" size={16} />
                      </Menu.RadioItemIndicator>
                      Portfolio weight
                    </Menu.RadioItem>
                    <Menu.RadioItem value="drawdown">
                      <Menu.RadioItemIndicator>
                        <Check aria-hidden="true" size={16} />
                      </Menu.RadioItemIndicator>
                      Peak drawdown
                    </Menu.RadioItem>
                  </Menu.RadioGroup>
                </Menu.Group>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </div>
    </div>
  );
}

export function Submenu() {
  return (
    <div className="bg-canvas p-6 rounded-lg">
      <div className="flex items-center gap-3 rounded-lg border border-border bg-raised px-4 py-3 max-w-md">
        <span className="font-semibold text-foreground text-sm">
          Aldergrove Utilities
        </span>
        <Menu.Root defaultOpen modal={false}>
          <Menu.Trigger
            render={
              <Button className="ml-auto" size="sm" variant="secondary">
                Export
              </Button>
            }
          />
          <Menu.Portal>
            <Menu.Positioner align="start" side="bottom">
              <Menu.Popup className="outline-0">
                <Menu.Item>Export holdings</Menu.Item>
                <Menu.SubmenuRoot defaultOpen>
                  <Menu.SubmenuTrigger>Export evidence</Menu.SubmenuTrigger>
                  <Menu.Portal>
                    <Menu.Positioner align="start" side="inline-end">
                      <Menu.Popup className="outline-0">
                        <Menu.Item>Cited filings (PDF)</Menu.Item>
                        <Menu.Item>Source table (CSV)</Menu.Item>
                        <Menu.Item disabled>Broker notes (licensed)</Menu.Item>
                      </Menu.Popup>
                    </Menu.Positioner>
                  </Menu.Portal>
                </Menu.SubmenuRoot>
                <Menu.Separator />
                <Menu.Item>Copy share link</Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </div>
    </div>
  );
}

export function ClosedTriggers() {
  return (
    <div className="bg-canvas p-6 rounded-lg">
      <div className="flex flex-col gap-3 max-w-md">
        <span className="text-foreground-secondary text-xs">
          The closed state: a menu is only its trigger until it is opened.
        </span>
        <div className="flex items-center gap-2">
          <Menu.Root>
            <Menu.Trigger
              render={
                <Button size="sm" variant="secondary">
                  Table options
                </Button>
              }
            />
            <Menu.Portal>
              <Menu.Positioner>
                <Menu.Popup>
                  <Menu.Item>Show all columns</Menu.Item>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
          <Menu.Root disabled>
            <Menu.Trigger
              render={
                <Button disabled size="sm" variant="secondary">
                  Rebalance
                </Button>
              }
            />
            <Menu.Portal>
              <Menu.Positioner>
                <Menu.Popup>
                  <Menu.Item>Propose trades</Menu.Item>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
          <Menu.Root>
            <Menu.Trigger
              render={
                <IconButton label="Holding actions" size="sm" variant="ghost">
                  <Ellipsis aria-hidden="true" size={16} />
                </IconButton>
              }
            />
            <Menu.Portal>
              <Menu.Positioner>
                <Menu.Popup>
                  <Menu.Item>Open thesis</Menu.Item>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        </div>
      </div>
    </div>
  );
}
