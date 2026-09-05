import { join, resolve } from "node:path";
import {
  type DeviceSettingsOptions,
  type DeviceSettingsService,
  type DeviceSkill,
  DeviceSettingsError,
  MODEL_PROVIDER,
  type ServiceReadiness,
} from "./device-settings-contract";
import {
  defaultRestart,
  MANAGED_SKILL_NAMES,
  nativeCommandRunner,
  parseDisabled,
  profileFrom,
  safeIdentifier,
  skillRows,
  sleep,
  withFileLock,
} from "./device-settings-native";
import {
  atomicWriteStore,
  requireStore,
  resolveConfigRoot,
  secIdentityStatus,
  settingsReadiness,
  tokenStatus,
} from "./device-settings-store";
import { hermesClient } from "./hermes";
import type { HermesToolset } from "./types";

export {
  DeviceSettingsError,
  type DeviceSettingsService,
  type DeviceSettingsSnapshot,
  type DeviceSkill,
  type Readiness,
  type ServiceReadiness,
} from "./device-settings-contract";
export { lifecycleCommandEnvironment } from "./device-settings-native";

export function createDeviceSettingsService(
  options: DeviceSettingsOptions = {},
): DeviceSettingsService {
  const environment = options.environment ?? process.env;
  const client = options.client ?? hermesClient;
  const command = options.command ?? nativeCommandRunner(environment);
  const restartHermes = options.restartHermes ?? defaultRestart(environment);
  const fetcher = options.fetch ?? fetch;
  const attempts = options.readbackAttempts ?? 40;
  const delay = options.readbackDelayMs ?? 125;

  function paths() {
    const configRoot = resolveConfigRoot(environment, options.configRoot);
    return {
      secrets: join(configRoot, "secrets.json"),
      settings: join(configRoot, "settings.json"),
      lock:
        options.lockPath ??
        (environment.PYTHIA_STATE_ROOT
          ? join(
              resolve(environment.PYTHIA_STATE_ROOT),
              "capability-mutation.lock",
            )
          : join(configRoot, "capability-mutation.lock")),
    };
  }

  async function disabledSkills(profile: string) {
    return parseDisabled(
      (
        await command([
          "-p",
          profile,
          "config",
          "get",
          "skills.disabled",
          "--json",
        ])
      ).stdout,
    );
  }

  async function modelAuth() {
    try {
      const result = await command(["auth", "status", MODEL_PROVIDER]);
      const first = result.stdout.trim().split(/\r?\n/u, 1)[0] ?? "";
      if (first === `${MODEL_PROVIDER}: logged in`)
        return "configured" as const;
      if (first.startsWith(`${MODEL_PROVIDER}: logged out`))
        return "missing" as const;
      return "unavailable" as const;
    } catch {
      return "unavailable" as const;
    }
  }

  async function basicMemory() {
    const raw = environment.PYTHIA_BASIC_MEMORY_MCP_URL;
    if (!raw) return "unavailable" as const;
    try {
      const url = new URL(raw);
      if (
        url.protocol !== "http:" ||
        !["127.0.0.1", "localhost"].includes(url.hostname) ||
        url.username ||
        url.password
      ) {
        return "unavailable" as const;
      }
      const response = await fetcher(url, {
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "pythia-desk", version: "0.1" },
          },
        }),
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        method: "POST",
        signal: AbortSignal.timeout(2_000),
      });
      const contentType = response.headers.get("content-type") ?? "";
      return response.ok &&
        (contentType.includes("json") || contentType.includes("event-stream"))
        ? ("ready" as const)
        : ("unavailable" as const);
    } catch {
      return "unavailable" as const;
    }
  }

  async function waitForSkill(name: string, enabled: boolean) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const items = await client.listSkills();
        const match = items.find((item) => item.name === name);
        if (Boolean(match) === enabled) return match;
      } catch {
        // A bounded restart window is expected; only exact final readback wins.
      }
      if (attempt + 1 < attempts) await sleep(delay);
    }
    throw new DeviceSettingsError(
      "Hermes did not confirm the global skill change after restart.",
      502,
      "skill_readback_failed",
    );
  }

  async function waitForToolset(name: string, enabled: boolean) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const items = await client.listToolsets();
        const match = items.find((item) => item.name === name);
        if (match?.enabled === enabled) return match;
      } catch {
        // A bounded restart window is expected; only exact final readback wins.
      }
      if (attempt + 1 < attempts) await sleep(delay);
    }
    throw new DeviceSettingsError(
      "Hermes did not confirm the API Server toolset change after restart.",
      502,
      "toolset_readback_failed",
    );
  }

  return {
    async snapshot() {
      const current = paths();
      let profile: string | null = null;
      let skills: DeviceSkill[] = [];
      let toolsets: HermesToolset[] = [];
      let skillsStatus: ServiceReadiness = "ready";
      let toolsetsStatus: ServiceReadiness = "ready";
      try {
        profile = profileFrom(environment, options.profile);
        const [nativeSkills, disabled] = await Promise.all([
          client.listSkills(),
          disabledSkills(profile),
        ]);
        skills = skillRows(nativeSkills, disabled);
      } catch {
        skillsStatus = "unavailable";
      }
      try {
        toolsets = await client.listToolsets();
      } catch {
        toolsetsStatus = "unavailable";
      }
      return {
        model_auth: {
          provider: MODEL_PROVIDER,
          status: await modelAuth(),
          setup_command: environment.PYTHIA_LIFECYCLE_COMMAND
            ? "pythia auth openai-codex"
            : "just auth openai-codex",
        },
        sec_identity: {
          status: settingsReadiness(current.settings, "sec_identity", false),
        },
        eodhd_credential: {
          status: settingsReadiness(current.secrets, "eodhd_api_token", true),
        },
        basic_memory: { status: await basicMemory() },
        skills,
        skills_status: skillsStatus,
        toolsets,
        toolsets_status: toolsetsStatus,
      };
    },

    async setSecIdentity(value) {
      const current = paths();
      const normalized = value?.trim() ?? null;
      if (
        normalized !== null &&
        secIdentityStatus(normalized) !== "configured"
      ) {
        throw new DeviceSettingsError(
          "Enter an SEC identity containing a name and email address.",
          400,
          "invalid_sec_identity",
        );
      }
      return withFileLock(current.lock, async () => {
        const store = requireStore(current.settings);
        if (normalized === null) delete store.sec_identity;
        else store.sec_identity = normalized;
        atomicWriteStore(current.settings, store);
        return { status: normalized === null ? "missing" : "configured" };
      });
    },

    async setEodhdToken(value) {
      const current = paths();
      const normalized = value?.trim() ?? null;
      if (normalized !== null && tokenStatus(normalized) !== "configured") {
        throw new DeviceSettingsError(
          "Enter a valid EODHD API token.",
          400,
          "invalid_eodhd_token",
        );
      }
      return withFileLock(current.lock, async () => {
        const store = requireStore(current.secrets);
        if (normalized === null) delete store.eodhd_api_token;
        else store.eodhd_api_token = normalized;
        atomicWriteStore(current.secrets, store);
        return { status: normalized === null ? "missing" : "configured" };
      });
    },

    async setSkillEnabled(rawName, enabled) {
      const name = safeIdentifier(rawName, "skill name");
      if (name === "hermes-agent") {
        throw new DeviceSettingsError(
          "Hermes keeps its essential agent skill enabled.",
          409,
          "essential_skill",
        );
      }
      const profile = profileFrom(environment, options.profile);
      return withFileLock(paths().lock, async () => {
        const [nativeSkills, disabled] = await Promise.all([
          client.listSkills(),
          disabledSkills(profile),
        ]);
        if (
          !nativeSkills.some((item) => item.name === name) &&
          !disabled.has(name)
        ) {
          throw new DeviceSettingsError(
            "Hermes does not know that skill.",
            404,
            "unknown_skill",
          );
        }
        if (enabled) disabled.delete(name);
        else disabled.add(name);
        const requested = [...disabled].sort();
        await command([
          "-p",
          profile,
          "config",
          "set",
          "skills.disabled",
          JSON.stringify(requested),
        ]);
        const stored = await disabledSkills(profile);
        if (
          stored.size !== requested.length ||
          requested.some((item) => !stored.has(item))
        ) {
          throw new DeviceSettingsError(
            "Hermes did not preserve the requested global skill setting.",
            502,
            "skill_config_readback_failed",
          );
        }
        await restartHermes();
        const readback = await waitForSkill(name, enabled);
        return {
          ...(readback ?? { name }),
          name,
          enabled,
          kind: MANAGED_SKILL_NAMES.has(name)
            ? "pythia-provided-name"
            : "other-hermes-skill",
          mutable: true,
        };
      });
    },

    async setToolsetEnabled(rawName, enabled) {
      const name = safeIdentifier(rawName, "toolset name");
      const profile = profileFrom(environment, options.profile);
      return withFileLock(paths().lock, async () => {
        const before = await client.listToolsets();
        if (!before.some((item) => item.name === name)) {
          throw new DeviceSettingsError(
            "Hermes does not know that API Server toolset.",
            404,
            "unknown_toolset",
          );
        }
        await command([
          "-p",
          profile,
          "tools",
          enabled ? "enable" : "disable",
          name,
          "--platform",
          "api_server",
        ]);
        await restartHermes();
        return waitForToolset(name, enabled);
      });
    },
  };
}

export const deviceSettingsService = createDeviceSettingsService();
