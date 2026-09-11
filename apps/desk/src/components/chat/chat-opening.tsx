"use client";

import { PythiaLockup } from "@pythia/ui";
import type { ReactNode } from "react";

/** Identity and invitation for an empty conversation. */
export function ChatOpening() {
  return (
    <div
      className="flex flex-none flex-col items-center gap-3 @[48rem]/chat:px-6 px-4 pb-4 text-center"
      data-slot="chat-opening"
    >
      {/* The mark alone: the question underneath already names the
          surface, so the wordmark would only repeat it. Sized in em, which
          is what the variant scales from. */}
      <PythiaLockup className="text-[2.25rem]" decorative variant="mark" />
      {/*
       * The theme has no heading step between body and the display clamp, and
       * the clamp is sized for a marketing hero. These are the design's two
       * sizes for this line: one for the docked column, one for the full width.
       */}
      <h2 className="m-0 font-medium @[48rem]/chat:text-[1.375rem] text-[1.0625rem] text-foreground leading-tight tracking-[-0.01em]">
        What are you working on?
      </h2>
    </div>
  );
}

/** Center the invitation and composer as one group in the available space. */
export function ChatOpeningLayout({ composer }: { composer: ReactNode }) {
  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-y-auto @[48rem]/chat:px-6 px-4 py-6"
      data-slot="chat-opening-layout"
    >
      <div
        className="my-auto w-full flex-none"
        data-slot="chat-opening-content"
      >
        <ChatOpening />
        {composer}
      </div>
    </div>
  );
}

/** The width running prose is set to, and the gutters around it. */
export const CHAT_MEASURE_CLASS =
  "mx-auto w-full max-w-full @[48rem]/chat:max-w-[45rem]";
