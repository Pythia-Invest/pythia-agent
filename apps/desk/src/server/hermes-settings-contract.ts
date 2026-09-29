/**
 * What the browser receives from Hermes's settings server, after Desk's
 * server has narrowed it: only fields Settings shows, never a credential
 * value, local path or command line.
 */

export type ConfigFieldType =
  | "boolean"
  | "number"
  | "select"
  | "string"
  | "list"
  | "text";

export type ConfigFieldSchema = {
  type: ConfigFieldType;
  description?: string;
  options?: string[];
  /** A long closed list, such as time zones, is picked by searching. */
  searchable?: boolean;
  /** Blank is a valid choice that means "use the default". */
  clearable?: boolean;
};

/** Settings-page fields, flat by dotted key, with their current values. */
export type HermesConfigView = {
  schema: Record<string, ConfigFieldSchema>;
  values: Record<string, unknown>;
  /** The main model, which Settings changes through Hermes's model assignment. */
  model: { provider: string; model: string };
};

/** A model provider Hermes signs in to with an account rather than a key. */
export type ProviderAccount = {
  id: string;
  name: string;
  /** `device_code` signs in here; `external` needs a command on the device. */
  flow: "device_code" | "external";
  docsUrl?: string;
  command?: string;
  connected: boolean;
  /** Where the sign-in came from, such as "Claude Code". */
  source?: string;
  disconnectable: boolean;
};

/** A provider credential or setting Hermes keeps in its `.env`. */
export type ProviderKey = {
  key: string;
  /** What the variable is, such as "OpenRouter API key". */
  label: string;
  /** The provider it belongs to, for grouping. */
  provider: string;
  docsUrl?: string;
  advanced: boolean;
  set: boolean;
  secret: boolean;
  /** The last four characters, when Hermes shows them. */
  hint?: string;
};

export type ProvidersView = {
  accounts: ProviderAccount[];
  keys: ProviderKey[];
};

export type AccountSignIn = {
  sessionId: string;
  userCode: string;
  verificationUrl: string;
  expiresIn: number;
};

export type AccountSignInStatus = {
  status: string;
  message?: string;
};

export type CustomEndpoint = {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  models: string[];
  hasKey: boolean;
  current: boolean;
};

export type CustomEndpointInput = {
  name: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
  makeDefault?: boolean;
};

export type McpServer = {
  name: string;
  transport: string;
  enabled: boolean;
  /** Selected tools, or null when every tool the server offers is on. */
  tools: string[] | null;
};

export type AgentPlugin = {
  name: string;
  version?: string;
  description?: string;
  source: string;
  active: boolean;
  /** Why it can't be switched off here. */
  locked?: string;
  /** A sign-in the plugin needs, run on the device. */
  authCommand?: string;
};

export type ModelAssignment = {
  ok: boolean;
  /** Hermes asks for confirmation first, e.g. for an expensive model. */
  confirm?: string;
};
