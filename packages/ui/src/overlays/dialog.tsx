"use client";

import { AlertDialog as BaseAlertDialog } from "@base-ui/react/alert-dialog";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import type { ComponentProps } from "react";
import { mergeClassName } from "./class-names";

function DialogBackdrop({
  className,
  ...props
}: ComponentProps<typeof BaseDialog.Backdrop>) {
  return (
    <BaseDialog.Backdrop
      className={mergeClassName("py-overlay-backdrop", className)}
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
      className={mergeClassName("py-dialog-viewport", className)}
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
      className={mergeClassName("py-dialog-popup", className)}
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
      className={mergeClassName("py-overlay-title", className)}
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
      className={mergeClassName("py-overlay-description", className)}
      {...props}
    />
  );
}

function DialogClose({
  className,
  ...props
}: ComponentProps<typeof BaseDialog.Close>) {
  return (
    <BaseDialog.Close
      className={mergeClassName("py-overlay-close", className)}
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
