import type { HermesClient, HermesSkill, HermesToolset } from "./types";
import type { ModelSelection } from "./model-catalog";

export const MODEL_PROVIDER = "openai-codex" as const;

export type Readiness = "configured" | "invalid" | "missing";
export type ServiceReadiness = "ready" | "unavailable";

export type DeviceSkill = HermesSkill & {
  enabled: boolean;
  kind: "pythia-provided-name" | "other-hermes-skill";
  mutable: boolean;
};

export type PluginPause = { plugin: string; paused: boolean };

export type DeviceSettingsSnapshot = {
  workspace: {
    root: string | null;
    native_cwd: string | null;
    status: "matched" | "different" | "unavailable";
  };
  model_auth: {
    provider: typeof MODEL_PROVIDER;
    status: Readiness | "unavailable";
  };
  skills: DeviceSkill[];
  skills_status: ServiceReadiness;
  toolsets: HermesToolset[];
  toolsets_status: ServiceReadiness;
};

export interface DeviceSettingsService {
  /** Save an empty profile's first-send model; true when this call saved it. */
  initializeModel(selection: ModelSelection): Promise<boolean>;
  /** Clear a first-send model if its run fails on provider credentials (null: it never started). */
  settleInitialModel(
    selection: ModelSelection,
    runId: string | null,
  ): Promise<void>;
  snapshot(): Promise<DeviceSettingsSnapshot>;
  setSkillEnabled(name: string, enabled: boolean): Promise<DeviceSkill>;
  setToolsetEnabled(name: string, enabled: boolean): Promise<HermesToolset>;
  /**
   * Pause or resume a data source in Pythia's own settings (Settings → Data
   * sources). Core reads the file on every use, so neither needs a restart.
   */
  setPluginPaused(name: string, paused: boolean): Promise<PluginPause>;
}

export type CommandRunner = (args: string[]) => Promise<{ stdout: string }>;

export type DeviceSettingsOptions = {
  client?: HermesClient;
  command?: CommandRunner;
  environment?: NodeJS.ProcessEnv;
  restartHermes?: () => Promise<void>;
  readbackAttempts?: number;
  readbackDelayMs?: number;
  /** Poll interval while watching a first-send run (default 500 ms, for two minutes). */
  firstRunPollMs?: number;
};

export class DeviceSettingsError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "DeviceSettingsError";
    this.status = status;
    this.code = code;
  }
}
