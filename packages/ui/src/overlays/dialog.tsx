"use client";

import { AlertDialog as BaseAlertDialog } from "@base-ui/react/alert-dialog";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import type { ComponentProps } from "react";
import { cnState } from "../class-name";
import { overlayClasses } from "./shared";

function DialogBackdrop({
  className,
  ...props
}: ComponentProps<typeof BaseDialog.Backdrop>) {
  return (
    <BaseDialog.Backdrop
      className={cnState(overlayClasses.backdrop, className)}
      data-slot="dialog-backdrop"
      {...props}
    />
  );
}

function DialogViewport({
  className,
  ...props
}: ComponentProps<typeof BaseDialog.Viewport>) {
  return (
    <BaseDialog.Viewport
      className={cnState(
        "fixed inset-0 z-50 grid place-items-center overflow-y-auto p-gutter",
        className,
      )}
      data-slot="dialog-viewport"
      {...props}
    />
  );
}

function DialogPopup({
  className,
  ...props
}: ComponentProps<typeof BaseDialog.Popup>) {
  return (
    <BaseDialog.Popup
      className={cnState(
        `${overlayClasses.surface} motion-standard max-h-[min(44rem,calc(100dvh-2*var(--spacing-gutter)))] w-[min(32rem,100%)] overflow-y-auto rounded-container p-6 transition-[opacity,transform] data-ending-style:scale-[0.98] data-starting-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:opacity-0`,
        className,
      )}
      data-slot="dialog-popup"
      {...props}
    />
  );
}

function DialogTitle({
  className,
  ...props
}: ComponentProps<typeof BaseDialog.Title>) {
  return (
    <BaseDialog.Title
      className={cnState(overlayClasses.title, className)}
      data-slot="dialog-title"
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof BaseDialog.Description>) {
  return (
    <BaseDialog.Description
      className={cnState(overlayClasses.description, className)}
      data-slot="dialog-description"
      {...props}
    />
  );
}

/*
 * `render` means the caller brought their own styled component. Base UI's
 * mergeProps concatenates class names rather than tailwind-merging them, so
 * applying the close recipe on top would let its `bg-transparent`/`border-0`
 * beat that component's own variant on CSS source order alone. Style the bare
 * close affordance; step aside for a supplied one.
 */
function DialogClose({
  className,
  render,
  ...props
}: ComponentProps<typeof BaseDialog.Close>) {
  return (
    <BaseDialog.Close
      className={render ? className : cnState(overlayClasses.close, className)}
      data-slot="dialog-close"
      render={render}
      {...props}
    />
  );
}

/**
 * Modal or non-modal dialog anatomy for focused tasks and supplemental content.
 * Its native Base UI parts retain controlled/uncontrolled open props, modal and
 * dismissal options, and open/closed transition states; the popup supplies the
 * shared elevated surface in Public/Product and light/dark. Base UI owns focus
 * trapping/restoration, keyboard Escape, outside press, portal, and screen-reader title
 * and description wiring. Compose Root, Trigger, Portal, Backdrop, Viewport,
 * Popup, Title, Description, and Close; do not use it as app workflow state.
 */
export const Dialog = {
  Root: BaseDialog.Root,
  Trigger: BaseDialog.Trigger,
  Portal: BaseDialog.Portal,
  Backdrop: DialogBackdrop,
  Viewport: DialogViewport,
  Popup: DialogPopup,
  Title: DialogTitle,
  Description: DialogDescription,
  Close: DialogClose,
} as const;

/**
 * Blocking confirmation dialog for consequential or destructive decisions.
 * Its parts inherit Base UI open props and mandatory modal, non-pointer-dismiss
 * behavior, while the shared popup styling follows both profiles and themes.
 * Base UI retains initial focus, focus restoration, keyboard Escape, portal,
 * and alert-dialog semantics; include an explicit safe action and cancel path.
 * Do not substitute this for ordinary validation or informational messaging.
 */
export const AlertDialog = {
  Root: BaseAlertDialog.Root,
  Trigger: BaseAlertDialog.Trigger,
  Portal: BaseAlertDialog.Portal,
  Backdrop: DialogBackdrop,
  Viewport: DialogViewport,
  Popup: DialogPopup,
  Title: DialogTitle,
  Description: DialogDescription,
  Close: DialogClose,
} as const;
