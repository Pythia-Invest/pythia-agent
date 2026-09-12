import { ContextMenu } from "@pythia/ui";
import { Check, Copy, FileText, Trash2 } from "lucide-react";

/**
 * A context menu opens at the pointer, which a static capture has no way to
 * produce. The open stories pass a fixed virtual anchor to the positioner —
 * the same escape hatch Base UI uses internally to place the popup at the
 * click coordinates — so the composition renders deterministically.
 *
 * `outline-0` on the open popups is a capture concession, not a pattern to
 * copy: Base UI moves focus into the popup on open, and with no prior user
 * interaction the browser treats that as keyboard focus and paints the focus
 * ring. A real pointer-opened menu has no ring.
 */
function pointerAt(x: number, y: number) {
  return { getBoundingClientRect: () => new DOMRect(x, y, 0, 0) };
}

function FilingRow({
  meta,
  title,
}: {
  meta: string;
  title: string;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-3">
      <FileText aria-hidden="true" size={16} />
      <div className="flex flex-col gap-1 min-w-0">
        <span className="font-medium text-foreground text-sm">{title}</span>
        <span className="text-foreground-secondary text-xs">{meta}</span>
      </div>
    </div>
  );
}

export function FilingListTarget() {
  return (
    <div className="bg-canvas p-6 rounded-lg">
      <div className="flex flex-col gap-2 max-w-md">
        <span className="text-foreground-secondary text-xs">
          Right-click or long-press a filing. Every action here is also
          reachable from the row&rsquo;s visible menu.
        </span>
        <ContextMenu.Root>
          <ContextMenu.Trigger className="rounded-lg border border-border-strong bg-raised overflow-hidden">
            <FilingRow
              meta="Northwind Grid Utilities · filed 26 Feb 2029"
              title="Annual report 2028"
            />
            <FilingRow
              meta="Northwind Grid Utilities · filed 14 Aug 2028"
              title="Half-year statement"
            />
            <FilingRow
              meta="Northwind Grid Utilities · filed 9 May 2028"
              title="Capital markets day deck"
            />
          </ContextMenu.Trigger>
          <ContextMenu.Portal>
            <ContextMenu.Positioner>
              <ContextMenu.Popup>
                <ContextMenu.Item>Open filing</ContextMenu.Item>
                <ContextMenu.Item>Copy citation</ContextMenu.Item>
              </ContextMenu.Popup>
            </ContextMenu.Positioner>
          </ContextMenu.Portal>
        </ContextMenu.Root>
      </div>
    </div>
  );
}

export function OpenAtPointer() {
  return (
    <div className="bg-canvas p-6 rounded-lg">
      <ContextMenu.Root defaultOpen>
        <ContextMenu.Trigger className="rounded-lg border border-border-strong bg-raised overflow-hidden max-w-md">
          <FilingRow
            meta="Calder Metals · filed 26 Feb 2029"
            title="Annual report 2028"
          />
          <FilingRow
            meta="Calder Metals · filed 14 Aug 2028"
            title="Half-year statement"
          />
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Positioner anchor={pointerAt(300, 130)}>
            <ContextMenu.Popup className="outline-0">
              <ContextMenu.Item>
                <FileText aria-hidden="true" size={16} />
                Open filing
              </ContextMenu.Item>
              <ContextMenu.Item>
                <Copy aria-hidden="true" size={16} />
                Copy citation
              </ContextMenu.Item>
              <ContextMenu.Separator />
              <ContextMenu.Item disabled>
                Attach to thesis (read-only workspace)
              </ContextMenu.Item>
              <ContextMenu.Item className="text-error">
                <Trash2 aria-hidden="true" size={16} />
                Remove from evidence
              </ContextMenu.Item>
            </ContextMenu.Popup>
          </ContextMenu.Positioner>
        </ContextMenu.Portal>
      </ContextMenu.Root>
    </div>
  );
}

export function GroupedWithChoices() {
  return (
    <div className="bg-canvas p-6 rounded-lg">
      <ContextMenu.Root defaultOpen>
        <ContextMenu.Trigger className="flex flex-col gap-2 rounded-lg border border-border-strong bg-raised p-4 max-w-md">
          <span className="font-semibold text-foreground text-sm">
            Kestrel Logistics — evidence board
          </span>
          <span className="text-foreground-secondary text-xs leading-relaxed">
            Nine sources pinned. Context actions cover the board itself, not the
            individual sources.
          </span>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Positioner anchor={pointerAt(300, 140)}>
            <ContextMenu.Popup className="outline-0">
              <ContextMenu.Group>
                <ContextMenu.GroupLabel>Board</ContextMenu.GroupLabel>
                <ContextMenu.Item>Rename board</ContextMenu.Item>
                <ContextMenu.Item>Duplicate board</ContextMenu.Item>
              </ContextMenu.Group>
              <ContextMenu.Separator />
              <ContextMenu.Group>
                <ContextMenu.GroupLabel>Show</ContextMenu.GroupLabel>
                <ContextMenu.CheckboxItem defaultChecked>
                  <ContextMenu.CheckboxItemIndicator>
                    <Check aria-hidden="true" size={16} />
                  </ContextMenu.CheckboxItemIndicator>
                  Retrieval dates
                </ContextMenu.CheckboxItem>
                <ContextMenu.CheckboxItem>
                  <ContextMenu.CheckboxItemIndicator>
                    <Check aria-hidden="true" size={16} />
                  </ContextMenu.CheckboxItemIndicator>
                  Superseded sources
                </ContextMenu.CheckboxItem>
              </ContextMenu.Group>
            </ContextMenu.Popup>
          </ContextMenu.Positioner>
        </ContextMenu.Portal>
      </ContextMenu.Root>
    </div>
  );
}
