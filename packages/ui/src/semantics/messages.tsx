import { clsx } from "clsx";
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
import type { KnowledgeStateKind, SemanticMessageTone } from "./types";

const messagePresentation = {
  information: {
    icon: CircleAlert,
    label: "Information",
    classes:
      "[border-color:var(--py-status-info-border)] bg-[var(--py-status-info-surface)] [--message-accent:var(--py-status-info-foreground)]",
  },
  success: {
    icon: CircleCheck,
    label: "Success",
    classes:
      "[border-color:var(--py-status-success-border)] bg-[var(--py-status-success-surface)] [--message-accent:var(--py-status-success-foreground)]",
  },
  warning: {
    icon: TriangleAlert,
    label: "Warning",
    classes:
      "[border-color:var(--py-status-warning-border)] bg-[var(--py-status-warning-surface)] [--message-accent:var(--py-status-warning-foreground)]",
  },
  error: {
    icon: CircleX,
    label: "Error",
    classes:
      "[border-color:var(--py-status-error-border)] bg-[var(--py-status-error-surface)] [--message-accent:var(--py-status-error-foreground)]",
  },
} satisfies Record<
  SemanticMessageTone,
  {
    icon: typeof CircleAlert;
    label: string;
    classes: string;
  }
>;

const knowledgePresentation = {
  "no-evidence": {
    icon: SearchX,
    label: "No evidence found",
    classes:
      "[border-color:var(--py-border-default)] [--knowledge-accent:var(--py-text-secondary)]",
  },
  "insufficient-coverage": {
    icon: ShieldAlert,
    label: "Insufficient coverage",
    classes:
      "[border-color:var(--py-status-info-border)] [--knowledge-accent:var(--py-status-info-foreground)]",
  },
  stale: {
    icon: ClockAlert,
    label: "Stale source",
    classes:
      "[border-color:var(--py-border-default)] [--knowledge-accent:var(--py-freshness-stale)]",
  },
  unavailable: {
    icon: FileQuestion,
    label: "Calculation unavailable",
    classes:
      "[border-color:var(--py-border-default)] [--knowledge-accent:var(--py-text-secondary)]",
  },
  failed: {
    icon: CircleX,
    label: "Operation failed",
    classes:
      "[border-color:var(--py-status-error-border)] [--knowledge-accent:var(--py-status-error-foreground)]",
  },
} satisfies Record<
  KnowledgeStateKind,
  {
    icon: typeof CircleAlert;
    label: string;
    classes: string;
  }
>;

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
      className={clsx(
        "flex items-start gap-[var(--py-space-3)] rounded-[var(--py-radius-interactive)] border border-solid p-[var(--py-space-4)] [color:var(--py-text-primary)]",
        presentation.classes,
        className,
      )}
      role={tone === "error" ? "alert" : "status"}
    >
      <Icon
        aria-hidden="true"
        className="mt-0.5 size-5 shrink-0 [color:var(--message-accent)]"
        strokeWidth={2}
      />
      <div className="grid gap-[var(--py-space-1)]">
        <span className="text-[length:var(--py-font-size-12)] font-bold uppercase tracking-[0.06em] [color:var(--message-accent)]">
          {presentation.label}
        </span>
        <strong className="text-[length:var(--py-font-size-14)] font-semibold">
          {title}
        </strong>
        {children === undefined ? null : (
          <div className="text-[length:var(--py-font-size-12)] leading-[var(--py-line-height-ui)]">
            {children}
          </div>
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
      className={clsx(
        "flex items-start gap-[var(--py-space-3)] border-y border-solid bg-transparent py-[var(--py-space-3)] [color:var(--py-text-primary)]",
        presentation.classes,
        className,
      )}
      role={state === "failed" ? "alert" : "status"}
    >
      <Icon
        aria-hidden="true"
        className="mt-0.5 size-5 shrink-0 [color:var(--knowledge-accent)]"
        strokeWidth={2}
      />
      <div className="grid gap-[var(--py-space-1)]">
        <strong className="text-[length:var(--py-font-size-14)] font-semibold">
          {presentation.label}
        </strong>
        {children === undefined ? null : (
          <div className="text-[length:var(--py-font-size-12)] leading-[var(--py-line-height-ui)] [color:var(--py-text-secondary)]">
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
