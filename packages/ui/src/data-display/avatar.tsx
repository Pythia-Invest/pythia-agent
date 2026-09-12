"use client";

import { Avatar as BaseAvatar } from "@base-ui/react/avatar";
import { cn } from "../class-name";

/** Shared avatar sizes for compact Product and more spacious Public contexts. */
export type AvatarSize = "small" | "medium" | "large";

/** Props for a supplied avatar image and explicit textual fallback. */
export interface AvatarProps {
  label: string;
  fallback: string;
  src?: string;
  size?: AvatarSize;
  className?: string;
}

const sizes: Record<AvatarSize, string> = {
  small: "size-[calc(var(--spacing-control)-0.25rem)] text-xs",
  medium: "size-control text-sm",
  large: "size-[calc(var(--spacing-control)+1rem)] text-lg",
};

/**
 * Displays a supplied profile image or explicit fallback text at small, medium,
 * or large size. Base UI owns image loading and fallback state; profile sizing
 * and light/dark semantic surfaces remain shared. The image has a meaningful
 * accessible label and no keyboard behavior. Do supply truthful fallback text;
 * don't derive identity or fetch application data here.
 */
export function Avatar({
  label,
  fallback,
  src,
  size = "medium",
  className,
}: AvatarProps) {
  return (
    <BaseAvatar.Root
      className={cn(
        "relative inline-grid flex-none place-items-center overflow-hidden rounded-full border border-border bg-subtle font-semibold text-foreground-secondary leading-none",
        sizes[size],
        className,
      )}
      data-size={size}
      data-slot="avatar"
    >
      {src ? (
        <BaseAvatar.Image
          alt={label}
          className="absolute inset-0 size-full object-cover"
          src={src}
        />
      ) : null}
      <BaseAvatar.Fallback className="uppercase">
        {fallback}
      </BaseAvatar.Fallback>
    </BaseAvatar.Root>
  );
}
