"use client";

import { Drawer as BaseDrawer } from "@base-ui/react/drawer";
import type { ComponentProps } from "react";
import { mergeClassName } from "./class-names";

function DrawerBackdrop({
  className,
  ...props
}: ComponentProps<typeof BaseDrawer.Backdrop>) {
  return (
    <BaseDrawer.Backdrop
      className={mergeClassName(
        "py-overlay-backdrop py-drawer-backdrop",
        className,
      )}
      {...props}
    />
  );
}

function DrawerViewport({
  className,
  ...props
}: ComponentProps<typeof BaseDrawer.Viewport>) {
  return (
    <BaseDrawer.Viewport
      className={mergeClassName("py-drawer-viewport", className)}
      {...props}
    />
  );
}

function DrawerPopup({
  className,
  ...props
}: ComponentProps<typeof BaseDrawer.Popup>) {
  return (
    <BaseDrawer.Popup
      className={mergeClassName("py-drawer-popup", className)}
      {...props}
    />
  );
}

function DrawerContent({
  className,
  ...props
}: ComponentProps<typeof BaseDrawer.Content>) {
  return (
    <BaseDrawer.Content
      className={mergeClassName("py-drawer-content", className)}
      {...props}
    />
  );
}

function DrawerTitle({
  className,
  ...props
}: ComponentProps<typeof BaseDrawer.Title>) {
  return (
    <BaseDrawer.Title
      className={mergeClassName("py-overlay-title", className)}
      {...props}
    />
  );
}

function DrawerDescription({
  className,
  ...props
}: ComponentProps<typeof BaseDrawer.Description>) {
  return (
    <BaseDrawer.Description
      className={mergeClassName("py-overlay-description", className)}
      {...props}
    />
  );
}

function DrawerClose({
  className,
  ...props
}: ComponentProps<typeof BaseDrawer.Close>) {
  return (
    <BaseDrawer.Close
      className={mergeClassName("py-overlay-close", className)}
      {...props}
    />
  );
}

function DrawerSwipeArea({
  className,
  ...props
}: ComponentProps<typeof BaseDrawer.SwipeArea>) {
  return (
    <BaseDrawer.SwipeArea
      className={mergeClassName("py-drawer-swipe-area", className)}
      {...props}
    />
  );
}

/**
 * Edge-mounted drawer anatomy for temporary, spatially related content.
 * Root exposes Base UI modal, direction, snap-point, controlled, and swipe
 * props; native open/closed/swiping states drive a profile- and theme-aware
 * elevated surface. Base UI owns the portal, focus lifecycle, keyboard Escape/outside
 * dismissal, touch scroll locking, and swipe/snap mechanics. Keep Popup inside
 * Viewport and Content inside Popup; do not recreate gestures or focus logic.
 */
export const Drawer = {
  Provider: BaseDrawer.Provider,
  IndentBackground: BaseDrawer.IndentBackground,
  Indent: BaseDrawer.Indent,
  Root: BaseDrawer.Root,
  Trigger: BaseDrawer.Trigger,
  VirtualKeyboardProvider: BaseDrawer.VirtualKeyboardProvider,
  Portal: BaseDrawer.Portal,
  Backdrop: DrawerBackdrop,
  Viewport: DrawerViewport,
  Popup: DrawerPopup,
  Content: DrawerContent,
  Title: DrawerTitle,
  Description: DrawerDescription,
  Close: DrawerClose,
  SwipeArea: DrawerSwipeArea,
} as const;

/**
 * Sheet naming for the same Base UI edge-drawer anatomy, typically using a
 * left or right Root `swipeDirection`. It retains every Drawer prop and native
 * open, modal, focus, keyboard, portal, dismissal, swipe, and snap-point state,
 * with identical semantic styling across Public/Product and light/dark. Use
 * the alias when “sheet” better describes a side panel; do not treat it as a
 * separate primitive or as persistent application layout.
 */
export const Sheet = Drawer;
