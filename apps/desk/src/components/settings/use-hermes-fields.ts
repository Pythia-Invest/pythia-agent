"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  useHermesConfig,
  useSaveHermesConfig,
} from "@/client/hermes-settings-queries";
import type { ConfigFieldSchema } from "@/server/hermes-settings-contract";
import { ENUM_OPTIONS, fieldDescription, fieldLabel } from "./field-copy";
import type { FieldSchema, FieldSource } from "./fields";

const AUTOSAVE_MS = 550;

function describe(key: string, raw: ConfigFieldSchema): FieldSchema {
  const options = ENUM_OPTIONS[key] ?? raw.options;
  return {
    type: raw.type,
    label: fieldLabel(key),
    description: fieldDescription(key, raw.description),
    options,
    searchable: raw.searchable,
    clearable: raw.clearable,
  };
}

/**
 * Hermes config as a field source. Edits show at once and save after a short
 * pause, as in Hermes Desktop; only the fields that changed are sent, so a
 * value changed elsewhere in the meantime is never overwritten.
 */
export function useHermesFields(): FieldSource {
  const query = useHermesConfig();
  const save = useSaveHermesConfig();
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const pending = useRef<Record<string, unknown>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mutate = save.mutate;

  const flush = useRef(() => {});
  flush.current = () => {
    const values = pending.current;
    pending.current = {};
    if (!Object.keys(values).length) return;
    mutate(values, {
      onSettled: () =>
        // Drop what was sent unless it changed again while saving; the saved
        // config now carries it.
        setDraft((current) => {
          const next = { ...current };
          for (const [key, value] of Object.entries(values))
            if (Object.is(next[key], value)) delete next[key];
          return next;
        }),
      onError: (error) =>
        setErrors((current) => ({
          ...current,
          ...Object.fromEntries(
            Object.keys(values).map((key) => [
              key,
              `Not saved: ${error.message}`,
            ]),
          ),
        })),
    });
  };
  // Save what is still pending when the page closes.
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      flush.current();
    },
    [],
  );

  const data = query.data;
  const schema = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(data?.schema ?? {}).map(([key, raw]) => [
          key,
          describe(key, raw),
        ]),
      ),
    [data?.schema],
  );
  return {
    schema,
    values: { ...data?.values, ...draft },
    status: query.isPending ? "pending" : query.isError ? "error" : "ready",
    error: query.error,
    retry: () => void query.refetch(),
    errors,
    change(key, value) {
      setDraft((current) => ({ ...current, [key]: value }));
      setErrors(({ [key]: _cleared, ...rest }) => rest);
      pending.current[key] = value;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => flush.current(), AUTOSAVE_MS);
    },
  };
}
