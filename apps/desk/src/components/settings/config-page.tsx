"use client";

import { Alert, Button, EmptyState } from "@pythia/ui";
import type { ReactNode } from "react";
import { hermesPages, pageFields } from "@/settings/hermes-pages";
import { ConfigField } from "./config-field";
import type { FieldSource } from "./fields";
import { RowsSkeleton } from "./primitives";

export function SourceState({
  source,
  rows = 4,
  children,
}: {
  source: Pick<FieldSource, "status" | "error" | "retry">;
  rows?: number;
  children: ReactNode;
}) {
  if (source.status === "pending") return <RowsSkeleton rows={rows} />;
  if (source.status === "error")
    return (
      <Alert
        tone="error"
        title="These settings didn't load"
        action={
          <Button size="sm" variant="secondary" onClick={source.retry}>
            Try again
          </Button>
        }
      >
        {source.error?.message ??
          "Pythia couldn't read these settings right now."}
      </Alert>
    );
  return <>{children}</>;
}

/** Rows for the given keys, in order, each from the source's schema. */
export function FieldRows({
  source,
  keys,
  controls,
}: {
  source: FieldSource;
  keys: readonly string[];
  controls?: Record<string, ReactNode> | undefined;
}) {
  const shown = keys.filter((key) => source.schema[key]);
  return (
    <div className="grid gap-1">
      {shown.map((key) => (
        <ConfigField
          key={key}
          id={key}
          field={
            source.schema[key] as NonNullable<(typeof source.schema)[string]>
          }
          source={source}
          control={controls?.[key]}
        />
      ))}
    </div>
  );
}

/** A page of Hermes settings: the fields its registry entry lists. */
export function HermesFieldsPage({
  pageId,
  source,
  controls,
}: {
  pageId: string;
  source: FieldSource;
  controls?: Record<string, ReactNode> | undefined;
}) {
  const page = hermesPages.find((item) => item.id === pageId);
  const keys = page ? pageFields(page, Object.keys(source.schema)) : [];
  return (
    <SourceState source={source}>
      {keys.length ? (
        <FieldRows source={source} keys={keys} controls={controls} />
      ) : (
        <EmptyState
          title="Nothing to set here yet"
          description="This version of Hermes has no settings for this page."
        />
      )}
    </SourceState>
  );
}
