"use client";

import {
  AlertDialog,
  ContextMenu,
  Dialog,
  Drawer,
  DropdownMenu,
  Popover,
  PreviewCard,
  Sheet,
  Tooltip,
} from "@pythia/ui";
import { useState } from "react";
import type { CatalogRoute } from "../../catalog";
import { DemoNote, Specimen, SpecimenGrid } from "./specimen";

export function OverlaysPreview({ route }: { route: CatalogRoute }) {
  const [status, setStatus] = useState("No synthetic overlay action yet.");

  switch (route) {
    case "/components/dialog":
      return (
        <SpecimenGrid>
          <Specimen label="Focused modal task">
            <Dialog.Root>
              <Dialog.Trigger className="catalog-trigger">
                Open synthetic dialog
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Backdrop />
                <Dialog.Viewport>
                  <Dialog.Popup>
                    <Dialog.Title>Synthetic review note</Dialog.Title>
                    <Dialog.Description>
                      This modal contains stable fictional content and tests
                      native focus, Escape, and dismissal.
                    </Dialog.Description>
                    <div className="catalog-overlay-actions">
                      <Dialog.Close className="catalog-trigger">
                        Cancel
                      </Dialog.Close>
                      <Dialog.Close
                        className="catalog-trigger catalog-trigger-primary"
                        onClick={() => setStatus("Synthetic note accepted.")}
                      >
                        Accept note
                      </Dialog.Close>
                    </div>
                  </Dialog.Popup>
                </Dialog.Viewport>
              </Dialog.Portal>
            </Dialog.Root>
            <DemoNote>{status}</DemoNote>
          </Specimen>
        </SpecimenGrid>
      );
    case "/components/alert-dialog":
      return (
        <SpecimenGrid>
          <Specimen label="Consequential confirmation">
            <AlertDialog.Root>
              <AlertDialog.Trigger className="catalog-trigger catalog-trigger-danger">
                Remove synthetic note
              </AlertDialog.Trigger>
              <AlertDialog.Portal>
                <AlertDialog.Backdrop />
                <AlertDialog.Viewport>
                  <AlertDialog.Popup>
                    <AlertDialog.Title>
                      Remove this synthetic note?
                    </AlertDialog.Title>
                    <AlertDialog.Description>
                      This only updates the local specimen status. No data is
                      changed.
                    </AlertDialog.Description>
                    <div className="catalog-overlay-actions">
                      <AlertDialog.Close className="catalog-trigger">
                        Keep note
                      </AlertDialog.Close>
                      <AlertDialog.Close
                        className="catalog-trigger catalog-trigger-danger"
                        onClick={() => setStatus("Synthetic note removed.")}
                      >
                        Remove note
                      </AlertDialog.Close>
                    </div>
                  </AlertDialog.Popup>
                </AlertDialog.Viewport>
              </AlertDialog.Portal>
            </AlertDialog.Root>
            <DemoNote>{status}</DemoNote>
          </Specimen>
        </SpecimenGrid>
      );
    case "/components/drawer-sheet":
      return (
        <SpecimenGrid>
          <Specimen label="Bottom drawer">
            <Drawer.Root>
              <Drawer.Trigger className="catalog-trigger">
                Open synthetic drawer
              </Drawer.Trigger>
              <Drawer.Portal>
                <Drawer.Backdrop />
                <Drawer.Viewport>
                  <Drawer.Popup>
                    <Drawer.Content>
                      <Drawer.Title>Synthetic evidence drawer</Drawer.Title>
                      <Drawer.Description>
                        Swipe or dismiss through Base UI native drawer behavior.
                      </Drawer.Description>
                      <Drawer.Close className="catalog-trigger">
                        Close drawer
                      </Drawer.Close>
                    </Drawer.Content>
                  </Drawer.Popup>
                </Drawer.Viewport>
              </Drawer.Portal>
            </Drawer.Root>
          </Specimen>
          <Specimen label="Side sheet alias">
            <Sheet.Root swipeDirection="right">
              <Sheet.Trigger className="catalog-trigger">
                Open synthetic sheet
              </Sheet.Trigger>
              <Sheet.Portal>
                <Sheet.Backdrop />
                <Sheet.Viewport>
                  <Sheet.Popup>
                    <Sheet.Content>
                      <Sheet.Title>Synthetic side sheet</Sheet.Title>
                      <Sheet.Description>
                        The Sheet name uses the same native drawer
                        implementation.
                      </Sheet.Description>
                      <Sheet.Close className="catalog-trigger">
                        Close sheet
                      </Sheet.Close>
                    </Sheet.Content>
                  </Sheet.Popup>
                </Sheet.Viewport>
              </Sheet.Portal>
            </Sheet.Root>
          </Specimen>
        </SpecimenGrid>
      );
    case "/components/popover":
      return (
        <SpecimenGrid>
          <Specimen label="Anchored interactive content">
            <Popover.Root>
              <Popover.Trigger className="catalog-trigger">
                Open synthetic details
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Positioner>
                  <Popover.Popup>
                    <Popover.Arrow />
                    <Popover.Title>Synthetic context</Popover.Title>
                    <Popover.Description>
                      A compact interactive overlay with native focus return and
                      dismissal.
                    </Popover.Description>
                    <Popover.Close className="catalog-trigger">
                      Done
                    </Popover.Close>
                  </Popover.Popup>
                </Popover.Positioner>
              </Popover.Portal>
            </Popover.Root>
          </Specimen>
        </SpecimenGrid>
      );
    case "/components/tooltip":
      return (
        <SpecimenGrid>
          <Specimen label="Brief supplemental hint">
            <Tooltip.Provider delay={250}>
              <Tooltip.Root>
                <Tooltip.Trigger className="catalog-trigger">
                  Focus or hover
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Positioner>
                    <Tooltip.Popup>
                      <Tooltip.Arrow />
                      Synthetic keyboard hint
                    </Tooltip.Popup>
                  </Tooltip.Positioner>
                </Tooltip.Portal>
              </Tooltip.Root>
            </Tooltip.Provider>
          </Specimen>
        </SpecimenGrid>
      );
    case "/components/preview-hover-card":
      return (
        <SpecimenGrid>
          <Specimen label="Richer non-essential preview">
            <PreviewCard.Root>
              <PreviewCard.Trigger
                className="catalog-preview-link"
                delay={200}
                href="#synthetic-entity"
              >
                Northstar Materials (synthetic)
              </PreviewCard.Trigger>
              <PreviewCard.Portal>
                <PreviewCard.Positioner>
                  <PreviewCard.Popup>
                    <PreviewCard.Arrow />
                    <strong>Fictional entity preview</strong>
                    <p>No customer, company, market, or performance claim.</p>
                  </PreviewCard.Popup>
                </PreviewCard.Positioner>
              </PreviewCard.Portal>
            </PreviewCard.Root>
          </Specimen>
        </SpecimenGrid>
      );
    case "/components/dropdown-menu":
      return (
        <SpecimenGrid>
          <Specimen label="Commands and native choices">
            <DropdownMenu.Root>
              <DropdownMenu.Trigger className="catalog-trigger">
                Open synthetic menu
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Positioner>
                  <DropdownMenu.Popup>
                    <DropdownMenu.Arrow />
                    <DropdownMenu.Group>
                      <DropdownMenu.GroupLabel>
                        Synthetic actions
                      </DropdownMenu.GroupLabel>
                      <DropdownMenu.Item
                        onClick={() => setStatus("Synthetic summary opened.")}
                      >
                        Open summary
                      </DropdownMenu.Item>
                      <DropdownMenu.Item disabled>
                        Export unavailable
                      </DropdownMenu.Item>
                    </DropdownMenu.Group>
                    <DropdownMenu.Separator />
                    <DropdownMenu.CheckboxItem defaultChecked>
                      <DropdownMenu.CheckboxItemIndicator>
                        ✓
                      </DropdownMenu.CheckboxItemIndicator>
                      Show labels
                    </DropdownMenu.CheckboxItem>
                  </DropdownMenu.Popup>
                </DropdownMenu.Positioner>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
            <DemoNote>{status}</DemoNote>
          </Specimen>
        </SpecimenGrid>
      );
    case "/components/context-menu":
      return (
        <SpecimenGrid>
          <Specimen label="Native right-click or long-press">
            <ContextMenu.Root>
              <ContextMenu.Trigger className="catalog-context-target">
                Right-click or long-press this labelled synthetic region.
              </ContextMenu.Trigger>
              <ContextMenu.Portal>
                <ContextMenu.Positioner>
                  <ContextMenu.Popup>
                    <ContextMenu.Group>
                      <ContextMenu.GroupLabel>
                        Synthetic context actions
                      </ContextMenu.GroupLabel>
                      <ContextMenu.Item
                        onClick={() =>
                          setStatus("Synthetic context note opened.")
                        }
                      >
                        Open note
                      </ContextMenu.Item>
                      <ContextMenu.Item>Copy label</ContextMenu.Item>
                    </ContextMenu.Group>
                    <ContextMenu.Separator />
                    <ContextMenu.Item disabled>
                      External action unavailable
                    </ContextMenu.Item>
                  </ContextMenu.Popup>
                </ContextMenu.Positioner>
              </ContextMenu.Portal>
            </ContextMenu.Root>
            <DemoNote>{status}</DemoNote>
          </Specimen>
        </SpecimenGrid>
      );
    default:
      throw new Error(`Missing curated overlays preview: ${route}`);
  }
}
