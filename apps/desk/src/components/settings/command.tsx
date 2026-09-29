"use client";

import { IconButton } from "@pythia/ui";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Code } from "./config-field";

/** A command the user runs on the device themselves, with a copy button. */
export function Command({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="flex items-center gap-1">
      <Code value={value} />
      <IconButton
        className="size-7 flex-none [&_svg]:size-3.5!"
        label={copied ? "Copied" : "Copy command"}
        size="sm"
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? <Check /> : <Copy />}
      </IconButton>
    </span>
  );
}
