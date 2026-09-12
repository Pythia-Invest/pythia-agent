"use client";

import { Drawer as BaseDrawer } from "@base-ui/react/drawer";
import type { ComponentProps } from "react";
import { cnState } from "../class-name";
import { overlayClasses } from "./shared";

function DrawerBackdrop({
  className,
  ...props
}: ComponentProps<typeof BaseDrawer.Backdrop>) {
  return (
    <BaseDrawer.Backdrop
      className={cnState(
        `${overlayClasses.backdrop} opacity-[calc(1-var(--drawer-swipe-progress,0))]`,
        className,
      )}
      data-slot="drawer-backdrop"
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
      className={cnState("pointer-events-none fixed inset-0 z-50", className)}
      data-slot="drawer-viewport"
      {...props}
    />
  );
}

/**
 * Base UI exposes the swipe as CSS variables on the popup; each edge maps the
 * movement onto its own axis and slides fully out in starting/ending styles.
 */
const drawerEdges = [
  // bottom edge
  "data-[swipe-direction=down]:inset-x-0 data-[swipe-direction=down]:bottom-0 data-[swipe-direction=down]:max-h-[calc(100dvh-1rem)] data-[swipe-direction=down]:rounded-t-container data-[swipe-direction=down]:translate-y-[calc(var(--drawer-swipe-movement-y,0px)+var(--drawer-snap-point-offset,0px))] data-[swipe-direction=down]:data-starting-style:translate-y-full data-[swipe-direction=down]:data-ending-style:translate-y-full",
  // top edge
  "data-[swipe-direction=up]:inset-x-0 data-[swipe-direction=up]:top-0 data-[swipe-direction=up]:max-h-[calc(100dvh-1rem)] data-[swipe-direction=up]:rounded-b-container data-[swipe-direction=up]:translate-y-[calc(var(--drawer-swipe-movement-y,0px)+var(--drawer-snap-point-offset,0px))] data-[swipe-direction=up]:data-starting-style:-translate-y-full data-[swipe-direction=up]:data-ending-style:-translate-y-full",
  // right edge (swipes left to dismiss)
  "data-[swipe-direction=left]:inset-y-0 data-[swipe-direction=left]:right-0 data-[swipe-direction=left]:w-[min(28rem,calc(100vw-1rem))] data-[swipe-direction=left]:rounded-l-container data-[swipe-direction=left]:translate-x-(--drawer-swipe-movement-x,0px) data-[swipe-direction=left]:data-starting-style:translate-x-full data-[swipe-direction=left]:data-ending-style:translate-x-full",
  // left edge (swipes right to dismiss)
  "data-[swipe-direction=right]:inset-y-0 data-[swipe-direction=right]:left-0 data-[swipe-direction=right]:w-[min(28rem,calc(100vw-1rem))] data-[swipe-direction=right]:rounded-r-container data-[swipe-direction=right]:translate-x-(--drawer-swipe-movement-x,0px) data-[swipe-direction=right]:data-starting-style:-translate-x-full data-[swipe-direction=right]:data-ending-style:-translate-x-full",
].join(" ");

function DrawerPopup({
  className,
  ...props
}: ComponentProps<typeof BaseDrawer.Popup>) {
  return (
    <BaseDrawer.Popup
      className={cnState(
        `${overlayClasses.surface} pointer-events-auto fixed flex max-h-full max-w-full flex-col transition-[transform,opacity] duration-[calc(var(--py-motion-standard)*var(--drawer-swipe-strength,1))] ease-standard data-swiping:select-none data-swiping:transition-none ${drawerEdges}`,
        className,
      )}
      data-slot="drawer-popup"
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
      className={cnState("overflow-y-auto p-6", className)}
      data-slot="drawer-content"
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
      className={cnState(overlayClasses.title, className)}
      data-slot="drawer-title"
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
      className={cnState(overlayClasses.description, className)}
      data-slot="drawer-description"
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
function DrawerClose({
  className,
  render,
  ...props
}: ComponentProps<typeof BaseDrawer.Close>) {
  return (
    <BaseDrawer.Close
      className={render ? className : cnState(overlayClasses.close, className)}
      data-slot="drawer-close"
      render={render}
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
      className={cnState(
        "fixed z-49 data-[swipe-direction=down]:inset-x-0 data-[swipe-direction=up]:inset-x-0 data-[swipe-direction=left]:inset-y-0 data-[swipe-direction=right]:inset-y-0 data-[swipe-direction=down]:top-0 data-[swipe-direction=left]:right-0 data-[swipe-direction=up]:bottom-0 data-[swipe-direction=right]:left-0 data-[swipe-direction=down]:h-6 data-[swipe-direction=up]:h-6 data-[swipe-direction=left]:w-6 data-[swipe-direction=right]:w-6",
        className,
      )}
      data-slot="drawer-swipe-area"
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
