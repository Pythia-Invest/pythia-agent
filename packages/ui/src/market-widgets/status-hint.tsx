"use client";
import { useRef, useState, type ReactNode } from "react";
import { cn } from "../class-name";
import { Tooltip } from "../overlays/tooltip";

/** One accessible interaction for market dots and status icons. The 32px target
 * is independent of the visual mark. Base UI owns focus, positioning and dismissal;
 * controlled state adds tap toggling without synthetic hover dismissing it. */
export function StatusHint({
  label,
  slot,
  children,
  className,
}: {
  label: string;
  slot: string;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const pressedWhileOpen = useRef(false);
  const touchInteraction = useRef(false);
  return (
    <Tooltip.Root
      open={open}
      onOpenChange={(value, details) => {
        if (touchInteraction.current && details.reason === "trigger-hover")
          return;
        setOpen(value);
      }}
    >
      <Tooltip.Trigger
        data-slot={slot}
        aria-label={label}
        delay={200}
        closeOnClick={false}
        onPointerEnter={(event) => {
          touchInteraction.current = event.pointerType === "touch";
        }}
        onPointerDown={(event) => {
          touchInteraction.current = event.pointerType === "touch";
          pressedWhileOpen.current = open;
        }}
        onClick={(event) =>
          setOpen(event.detail === 0 || !pressedWhileOpen.current)
        }
        className={cn(
          "inline-flex min-h-8 min-w-8 shrink-0 items-center justify-center gap-1 rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-ring",
          className,
        )}
      >
        {children}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner>
          <Tooltip.Popup>{label}</Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
