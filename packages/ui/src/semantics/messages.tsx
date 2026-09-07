import {
  CircleAlert,
  CircleCheck,
  CircleX,
  ClockAlert,
  FileQuestion,
  SearchX,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../class-name";
import type { KnowledgeStateKind, SemanticMessageTone } from "./types";

type Presentation = {
  icon: typeof CircleAlert;
  label: string;
  /** Border and surface of the container. */
  surface: string;
  /** Icon and label color; text stays primary for legibility. */
  accent: string;
};

const messagePresentation: Record<SemanticMessageTone, Presentation> = {
  information: {
    icon: CircleAlert,
    label: "Information",
    surface: "border-info-border bg-info-surface",
    accent: "text-info",
  },
  success: {
    icon: CircleCheck,
    label: "Success",
    surface: "border-success-border bg-success-surface",
    accent: "text-success",
  },
  warning: {
    icon: TriangleAlert,
    label: "Warning",
    surface: "border-warning-border bg-warning-surface",
    accent: "text-warning",
  },
  error: {
    icon: CircleX,
    label: "Error",
    surface: "border-error-border bg-error-surface",
    accent: "text-error",
  },
};

const knowledgePresentation: Record<KnowledgeStateKind, Presentation> = {
  "no-evidence": {
    icon: SearchX,
    label: "No evidence found",
    surface: "border-border",
    accent: "text-foreground-secondary",
  },
  "insufficient-coverage": {
    icon: ShieldAlert,
    label: "Insufficient coverage",
    surface: "border-info-border",
    accent: "text-info",
  },
  stale: {
    icon: ClockAlert,
    label: "Stale source",
    surface: "border-border",
    accent: "text-freshness-stale",
  },
  unavailable: {
    icon: FileQuestion,
    label: "Calculation unavailable",
    surface: "border-border",
    accent: "text-foreground-secondary",
  },
  failed: {
    icon: CircleX,
    label: "Operation failed",
    surface: "border-error-border",
    accent: "text-error",
  },
};

export interface SemanticMessageProps {
  /** Supplied interface meaning; warning remains separate from Pythia signal. */
  tone: SemanticMessageTone;
  /** Specific investor-facing message heading. */
  title: ReactNode;
  /** Supporting message detail. */
  children?: ReactNode;
  className?: string;
}

/**
 * Presents information, success, warning, or error with conventional icon,
 * label, outline, and wording in addition to color. Error uses `alert`; other
 * variants use `status`, so inserted messages are announced without custom
 * keyboard handling. Shared tokens keep profiles and themes aligned. Do use it
 * for durable labelled inline explanations; use Alert for compact, transient
 * interface status with an optional action. Do not use warning for Pythia signals or
 * let this component infer a tone from its copy.
 */
export function SemanticMessage({
  children,
  className,
  title,
  tone,
}: SemanticMessageProps) {
  const presentation = messagePresentation[tone];
  const Icon = presentation.icon;
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-control border p-4 text-foreground",
        presentation.surface,
        className,
      )}
      data-slot="semantic-message"
      data-tone={tone}
      role={tone === "error" ? "alert" : "status"}
    >
      <Icon
        aria-hidden="true"
        className={cn("mt-0.5 size-5 shrink-0", presentation.accent)}
        strokeWidth={2}
      />
      <div className="grid gap-1">
        <span
          className={cn(
            "font-bold text-xs uppercase tracking-[0.06em]",
            presentation.accent,
          )}
        >
          {presentation.label}
        </span>
        <strong className="font-semibold text-sm">{title}</strong>
        {children === undefined ? null : (
          <div className="text-xs leading-ui">{children}</div>
        )}
      </div>
    </div>
  );
}

export interface KnowledgeStateProps {
  /** Caller-established limitation or failure state. */
  state: KnowledgeStateKind;
  /** Calm, specific explanation of what is missing, stale, unavailable, or failed. */
  children?: ReactNode;
  className?: string;
}

/**
 * Distinguishes no evidence, insufficient coverage, a stale source, an
 * unavailable calculation, and an operation failure. Each state has explicit
 * wording and an icon; only failure is an `alert`, while honest limitations
 * are `status`. The neutral flat surface and semantic tokens work in both
 * profiles/themes without keyboard behavior. Do pass the known state and
 * useful detail; do not collapse states or infer one from absent data.
 */
export function KnowledgeState({
  children,
  className,
  state,
}: KnowledgeStateProps) {
  const presentation = knowledgePresentation[state];
  const Icon = presentation.icon;
  return (
    <div
      className={cn(
        "flex items-start gap-3 border-y bg-transparent py-3 text-foreground",
        presentation.surface,
        className,
      )}
      data-slot="knowledge-state"
      data-state={state}
      role={state === "failed" ? "alert" : "status"}
    >
      <Icon
        aria-hidden="true"
        className={cn("mt-0.5 size-5 shrink-0", presentation.accent)}
        strokeWidth={2}
      />
      <div className="grid gap-1">
        <strong className="font-semibold text-sm">{presentation.label}</strong>
        {children === undefined ? null : (
          <div className="text-foreground-secondary text-xs leading-ui">
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
