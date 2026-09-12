"use client";

import { AlertDialog, Badge, Button, Separator } from "@pythia/ui";
import { Trash2 } from "lucide-react";
import type { ReactNode } from "react";

/** The list an alert dialog opens over, so the backdrop dims real content. */
function WatchlistPage({ action }: { action: ReactNode }) {
  const rows = [
    { name: "Northwind Grid Utilities", note: "Regulated utilities · 3.6%" },
    { name: "Calder Metals", note: "Basic materials · 2.1%" },
    { name: "Kestrel Logistics", note: "Industrials · 1.4%" },
  ];
  return (
    <div className="bg-canvas p-4 rounded-lg">
      <div className="flex items-center justify-between gap-4 pb-4">
        <div className="flex flex-col gap-1 min-w-0">
          <span className="font-semibold text-base">European industrials</span>
          <span className="text-foreground-secondary text-xs">
            12 holdings · shared with 2 saved screens
          </span>
        </div>
        {action}
      </div>
      <Separator />
      <ul className="flex flex-col gap-3 list-none m-0 p-0 pt-4">
        {rows.map((row) => (
          <li className="flex items-baseline justify-between gap-4" key={row.name}>
            <span className="text-sm">{row.name}</span>
            <span className="text-foreground-secondary text-xs">{row.note}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DeleteWatchlist() {
  return (
    <AlertDialog.Root defaultOpen>
      <WatchlistPage
        action={
          <AlertDialog.Trigger
            render={
              <Button variant="danger">
                <Trash2 aria-hidden="true" size={16} />
                Delete watchlist
              </Button>
            }
          />
        }
      />
      <AlertDialog.Portal>
        <AlertDialog.Backdrop />
        <AlertDialog.Viewport>
          <AlertDialog.Popup>
            <AlertDialog.Title>
              Delete the “European industrials” watchlist?
            </AlertDialog.Title>
            <AlertDialog.Description>
              This removes the watchlist and everything filed under it from this
              device. It cannot be undone.
            </AlertDialog.Description>
            <ul className="flex flex-col gap-2 list-none m-0 mt-4 p-0">
              <li className="text-foreground-secondary text-sm">
                12 holdings and their position notes
              </li>
              <li className="text-foreground-secondary text-sm">
                2 saved screens that filter on this watchlist
              </li>
              <li className="text-foreground-secondary text-sm">
                Cached filings retrieved since 04 January 2029
              </li>
            </ul>
            <div className="flex items-center justify-end gap-3 mt-6">
              <AlertDialog.Close
                render={<Button variant="ghost">Keep watchlist</Button>}
              />
              <Button variant="danger">Delete watchlist</Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Viewport>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

export function DiscardScreenChanges() {
  return (
    <AlertDialog.Root defaultOpen>
      <WatchlistPage
        action={
          <AlertDialog.Trigger
            render={<Button variant="secondary">Leave screen</Button>}
          />
        }
      />
      <AlertDialog.Portal>
        <AlertDialog.Backdrop />
        <AlertDialog.Viewport>
          <AlertDialog.Popup>
            <AlertDialog.Title>Discard unsaved screen changes?</AlertDialog.Title>
            <AlertDialog.Description>
              Four filter changes to “Cash-generative mid caps” have not been
              saved. Leaving now discards them.
            </AlertDialog.Description>
            <div className="flex items-center justify-end gap-3 mt-6">
              <AlertDialog.Close
                render={<Button variant="ghost">Keep editing</Button>}
              />
              <Button variant="danger">Discard changes</Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Viewport>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

export function ClosedTrigger() {
  return (
    <div className="bg-canvas p-4 rounded-lg">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1 min-w-0">
          <span className="font-semibold text-sm">Cash-generative mid caps</span>
          <span className="text-foreground-secondary text-xs">
            Saved screen · last run 09 March 2029
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="warning">Unsaved</Badge>
          <AlertDialog.Root>
            <AlertDialog.Trigger
              render={
                <Button size="sm" variant="danger">
                  <Trash2 aria-hidden="true" size={16} />
                  Delete
                </Button>
              }
            />
            <AlertDialog.Portal>
              <AlertDialog.Backdrop />
              <AlertDialog.Viewport>
                <AlertDialog.Popup>
                  <AlertDialog.Title>Delete this saved screen?</AlertDialog.Title>
                  <AlertDialog.Description>
                    A closed alert dialog renders only its trigger; the
                    confirmation stays in a portal until it opens.
                  </AlertDialog.Description>
                </AlertDialog.Popup>
              </AlertDialog.Viewport>
            </AlertDialog.Portal>
          </AlertDialog.Root>
        </div>
      </div>
    </div>
  );
}
