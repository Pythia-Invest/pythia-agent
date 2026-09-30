import type { ConfigFieldType } from "@/server/hermes-settings-contract";

/**
 * One setting, described the same way whether Hermes or Pythia owns it, so
 * every page renders through the same row and control.
 */
export type FieldSchema = {
  type: ConfigFieldType | "credential" | "path";
  label: string;
  description?: string | undefined;
  options?: readonly string[] | undefined;
  optionLabels?: Record<string, string> | undefined;
  /** A few choices shown side by side instead of in a menu. */
  segmented?: boolean | undefined;
  /** Pick from a long list by searching. */
  searchable?: boolean | undefined;
  /** Blank is a choice, meaning "use the default". */
  clearable?: boolean | undefined;
  placeholder?: string | undefined;
  /** A credential typed as a password and shown only by its last characters. */
  secret?: boolean | undefined;
  docsUrl?: string | undefined;
};

/** How a credential stands, without its value. */
export type CredentialState = {
  set: boolean;
  /** What stands in for the value: "Ada Lovelace", "ends 4f2a". */
  display?: string | undefined;
  invalid?: boolean | undefined;
};

/**
 * Settings from one owner: their schema, current values, and how to change
 * them. Ordinary values save themselves as they change; credentials save
 * only when asked.
 */
export type FieldSource = {
  schema: Record<string, FieldSchema>;
  values: Record<string, unknown>;
  status: "pending" | "error" | "ready";
  error?: Error | null | undefined;
  retry: () => void;
  change: (key: string, value: unknown) => void;
  /** Why the last change to a field didn't save, by key. */
  errors?: Record<string, string> | undefined;
  credential?:
    | {
        state: (key: string) => CredentialState;
        /** Resolves to null once saved, or to why it wasn't. */
        save: (key: string, value: string | null) => Promise<string | null>;
        pending: boolean;
      }
    | undefined;
};
