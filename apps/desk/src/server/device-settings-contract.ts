import type { HermesClient, HermesSkill, HermesToolset } from "./types";

export const MODEL_PROVIDER = "openai-codex" as const;

export type Readiness = "configured" | "invalid" | "missing";
export type ServiceReadiness = "ready" | "unavailable";

export type DeviceSkill = HermesSkill & {
  enabled: boolean;
  kind: "pythia-provided-name" | "other-hermes-skill";
  mutable: boolean;
};

export type DeviceSettingsSnapshot = {
  model_auth: {
    provider: typeof MODEL_PROVIDER;
    status: Readiness | "unavailable";
    setup_command: string;
  };
  sec_identity: { status: Readiness };
  eodhd_credential: { status: Readiness };
  basic_memory: { status: ServiceReadiness };
  skills: DeviceSkill[];
  skills_status: ServiceReadiness;
  toolsets: HermesToolset[];
  toolsets_status: ServiceReadiness;
};

export interface DeviceSettingsService {
  snapshot(): Promise<DeviceSettingsSnapshot>;
  setSecIdentity(value: string | null): Promise<{ status: Readiness }>;
  setEodhdToken(value: string | null): Promise<{ status: Readiness }>;
  setSkillEnabled(name: string, enabled: boolean): Promise<DeviceSkill>;
  setToolsetEnabled(name: string, enabled: boolean): Promise<HermesToolset>;
}

export type CommandRunner = (args: string[]) => Promise<{ stdout: string }>;

export type DeviceSettingsOptions = {
  client?: HermesClient;
  command?: CommandRunner;
  configRoot?: string;
  environment?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  lockPath?: string;
  profile?: string;
  restartHermes?: () => Promise<void>;
  readbackAttempts?: number;
  readbackDelayMs?: number;
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
