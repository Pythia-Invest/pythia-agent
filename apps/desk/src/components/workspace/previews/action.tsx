"use client";
import { Button, IconButton, Tooltip } from "@pythia/ui";
import type { ComponentProps, ReactNode } from "react";

export function PreviewAction({
  text,
  tip,
  children,
  ...props
}: Omit<ComponentProps<typeof IconButton>, "children"> & {
  text?: string;
  tip?: string;
  children?: ReactNode;
}) {
  const button = text ? (
    <Button
      size={props.size ?? "sm"}
      variant="ghost"
      aria-label={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {children}
      {text}
    </Button>
  ) : (
    <IconButton {...props}>{children}</IconButton>
  );
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={button} />
      <Tooltip.Portal>
        <Tooltip.Positioner side="bottom">
          <Tooltip.Popup>{tip ?? props.label}</Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
