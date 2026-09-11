import type { ModelCatalog, ModelSelection } from "./model-catalog";

export type HermesSession = {
  id: string;
  title?: string | null;
  last_active?: number | null;
  preview?: string | null;
  message_count?: number | null;
  ended_at?: number | null;
};

export type HermesMessage = {
  id: string;
  role: string;
  content: unknown;
  timestamp?: number | null;
  tool_call_id?: string | null;
  tool_name?: string | null;
  tool_calls?: unknown;
  finish_reason?: string | null;
  reasoning?: string | null;
  /** Hermes presentation hint for rows a person did not type. */
  display_kind?: string | null;
};

export type RunUsage = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
};

export type HermesMessagePage = {
  data: HermesMessage[];
  limit: number;
  offset: number;
  returned: number;
};

export type HermesCapabilities = {
  runSteer: boolean;
  modelOptions: boolean;
};

export type ApprovalChoice = "once" | "session" | "always" | "deny";

export type DeskRunEvent = {
  event: string;
  run_id?: string;
  timestamp?: number;
  delta?: string;
  text?: string;
  tool?: string;
  preview?: string | null;
  duration?: number;
  error?: string | boolean;
  description?: string;
  command?: string;
  request_id?: string;
  choices?: ApprovalChoice[];
  choice?: ApprovalChoice;
  output?: string;
  usage?: RunUsage;
  status?: string;
  summary?: string;
  goal?: string;
  child_session_id?: string;
  task_count?: number;
  task_index?: number;
  subagent_id?: string;
  model?: string;
  tool_count?: number;
  duration_seconds?: number;
  input_tokens?: number;
  output_tokens?: number;
  reasoning_tokens?: number;
  api_calls?: number;
  cost_usd?: number;
  files_read?: string[];
  files_written?: string[];
  pending_steer?: string;
  code?: string;
};

export type RunStart = {
  run_id: string;
  status: string;
  replayed: boolean;
};

export type RunStatus = {
  run_id: string;
  status: string;
  session_id?: string;
  output?: string;
  error?: string;
  code?: string;
  approval?: DeskRunEvent;
  usage?: RunUsage;
  pending_steer?: string;
};

export type HermesSkill = {
  name: string;
  description?: string;
  category?: string | null;
};

export type HermesToolset = {
  name: string;
  label?: string;
  description?: string;
  enabled: boolean;
  configured: boolean;
  tools: string[];
};

export type HermesInput =
  | string
  | {
      role: "user";
      content: (
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      )[];
    }[];

export interface HermesClient {
  capabilities(): Promise<HermesCapabilities>;
  modelOptions(refresh?: boolean): Promise<ModelCatalog>;
  listSessions(limit: number, offset: number): Promise<HermesSession[]>;
  createSession(title?: string): Promise<HermesSession>;
  renameSession(sessionId: string, title: string): Promise<HermesSession>;
  listMessages(
    sessionId: string,
    limit: number,
    offset: number,
  ): Promise<HermesMessagePage>;
  startRun(
    sessionId: string,
    input: HermesInput,
    selection?: ModelSelection,
  ): Promise<RunStart>;
  getRun(runId: string): Promise<RunStatus>;
  streamRun(runId: string, signal?: AbortSignal): AsyncGenerator<DeskRunEvent>;
  respondToApproval(
    runId: string,
    choice: ApprovalChoice,
    requestId?: string,
  ): Promise<{ run_id: string; choice: ApprovalChoice; resolved: number }>;
  steerRun(
    runId: string,
    input: string,
  ): Promise<{ run_id: string; accepted: boolean }>;
  stopRun(runId: string): Promise<RunStatus>;
  listSkills(): Promise<HermesSkill[]>;
  listToolsets(): Promise<HermesToolset[]>;
}
