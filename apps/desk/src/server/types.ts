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
};

export type RunUsage = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
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
  request_id?: string;
  choices?: ApprovalChoice[];
  choice?: ApprovalChoice;
  output?: string;
  usage?: RunUsage;
  status?: string;
  summary?: string;
  goal?: string;
  child_session_id?: string;
  code?:
    | "model_auth_missing"
    | "model_selection_missing"
    | "model_provider_failed"
    | "stream_disconnected";
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
  code?:
    | "model_auth_missing"
    | "model_selection_missing"
    | "model_provider_failed";
  approval?: DeskRunEvent;
  usage?: RunUsage;
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

export interface HermesClient {
  modelOptions(): Promise<ModelCatalog>;
  listSessions(limit: number, offset: number): Promise<HermesSession[]>;
  createSession(title?: string): Promise<HermesSession>;
  renameSession(sessionId: string, title: string): Promise<HermesSession>;
  listMessages(sessionId: string): Promise<HermesMessage[]>;
  startRun(
    sessionId: string,
    input: string,
    selection?: ModelSelection,
  ): Promise<RunStart>;
  getRun(runId: string): Promise<RunStatus>;
  streamRun(runId: string, signal?: AbortSignal): AsyncGenerator<DeskRunEvent>;
  respondToApproval(
    runId: string,
    choice: ApprovalChoice,
    requestId?: string,
  ): Promise<{ run_id: string; choice: ApprovalChoice; resolved: number }>;
  stopRun(runId: string): Promise<RunStatus>;
  listSkills(): Promise<HermesSkill[]>;
  listToolsets(): Promise<HermesToolset[]>;
}
