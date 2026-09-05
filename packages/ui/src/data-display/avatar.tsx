"use client";

import { Avatar as BaseAvatar } from "@base-ui/react/avatar";

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
      className={["py-avatar", className].filter(Boolean).join(" ")}
      data-size={size}
    >
      {src ? (
        <BaseAvatar.Image alt={label} className="py-avatar__image" src={src} />
      ) : null}
      <BaseAvatar.Fallback className="py-avatar__fallback">
        {fallback}
      </BaseAvatar.Fallback>
    </BaseAvatar.Root>
  );
}
