import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assertPrivateFile, readJsonIfPresent } from "../install/files.mjs";
import { installedExecutables } from "../install/runtime.mjs";
import { systemctl, UNIT_NAMES } from "../install/systemd.mjs";
import { currentCheckout, verifyInstalledStable } from "../update/release.mjs";

function version(command, args) {
  try {
    const result = spawnSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
    });
    return result.status === 0 ? String(result.stdout).trim() : "unavailable";
  } catch {
    return "unavailable";
  }
}

async function endpoint(url, options = {}) {
  try {
    const response = await fetch(url, {
      headers: options.headers,
      body: options.body,
      method: options.method,
      signal: AbortSignal.timeout(2_000),
    });
    const contentType = response.headers.get("content-type") ?? "";
    return response.ok &&
      (!options.contentTypes ||
        options.contentTypes.some((value) => contentType.includes(value)))
      ? "ready"
      : "unavailable";
  } catch {
    return "unavailable";
  }
}

async function capabilities(paths, apiKey) {
  const headers = { Authorization: `Bearer ${apiKey}` };
  try {
    const [skillsResponse, toolsetsResponse] = await Promise.all([
      fetch(`http://127.0.0.1:${paths.ports.hermes}/v1/skills`, {
        headers,
        signal: AbortSignal.timeout(2_000),
      }),
      fetch(`http://127.0.0.1:${paths.ports.hermes}/v1/toolsets`, {
        headers,
        signal: AbortSignal.timeout(2_000),
      }),
    ]);
    if (!skillsResponse.ok || !toolsetsResponse.ok) {
      return { skills: "unavailable", api_server_toolsets: "unavailable" };
    }
    const skills = await skillsResponse.json();
    const toolsets = await toolsetsResponse.json();
    return {
      skills: Array.isArray(skills.data)
        ? skills.data.flatMap((item) =>
            typeof item?.name === "string" ? [item.name] : [],
          )
        : [],
      api_server_toolsets: Array.isArray(toolsets.data)
        ? toolsets.data.flatMap((item) =>
            typeof item?.name === "string"
              ? [{ name: item.name, enabled: item.enabled === true }]
              : [],
          )
        : [],
    };
  } catch {
    return { skills: "unavailable", api_server_toolsets: "unavailable" };
  }
}

function apiKey(paths) {
  const path = join(paths.configRoot, "secrets.json");
  if (!existsSync(path)) return null;
  try {
    assertPrivateFile(path);
    const value = JSON.parse(readFileSync(path, "utf8"));
    return typeof value.hermes_api_key === "string" &&
      value.hermes_api_key.length >= 16
      ? value.hermes_api_key
      : null;
  } catch {
    return null;
  }
}

function unitState() {
  return Object.fromEntries(
    UNIT_NAMES.map((name) => {
      try {
        return [name, systemctl(["is-active", name])];
      } catch {
        return [name, "inactive"];
      }
    }),
  );
}

function cachedGitRelationship(repository) {
  try {
    const result = spawnSync(
      "git",
      [
        "rev-list",
        "--left-right",
        "--count",
        "HEAD...refs/remotes/origin/main",
      ],
      {
        cwd: repository,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 10_000,
      },
    );
    if (result.status !== 0)
      return { relation: "unknown", ahead: null, behind: null };
    const [ahead, behind] = String(result.stdout)
      .trim()
      .split(/\s+/u)
      .map(Number);
    return {
      relation:
        ahead && behind
          ? "diverged"
          : ahead
            ? "ahead"
            : behind
              ? "behind"
              : "equal",
      ahead,
      behind,
    };
  } catch {
    return { relation: "unknown", ahead: null, behind: null };
  }
}

export async function doctor(paths) {
  const installation = readJsonIfPresent(paths.installFile);
  const release = readJsonIfPresent(paths.releaseFile);
  const checkout = paths.checkout
    ? currentCheckout(paths.checkout)
    : { head: null, clean: false, status: "missing", conflicted: "" };
  let executables;
  try {
    executables = installedExecutables(paths);
  } catch {
    executables = {
      node: "node",
      uv: "uv",
      python: "python3",
      hermes: "hermes",
      basicMemory: "basic-memory",
    };
  }
  const bearer = apiKey(paths);
  const headers = bearer ? { Authorization: `Bearer ${bearer}` } : undefined;
  const health = {
    hermes: await endpoint(`http://127.0.0.1:${paths.ports.hermes}/health`, {
      headers,
    }),
    basic_memory: await endpoint(`http://127.0.0.1:${paths.ports.memory}/mcp`, {
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "pythia-doctor", version: "0.1" },
        },
      }),
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      method: "POST",
      contentTypes: ["application/json", "text/event-stream"],
    }),
    desk: await endpoint(`http://127.0.0.1:${paths.ports.desk}/api/health`),
  };
  const relationship = paths.checkout
    ? cachedGitRelationship(paths.checkout)
    : { relation: "unknown", ahead: null, behind: null };
  const ownedRevision = installation?.revision === checkout.head;
  let releaseIntegrity = "not-applicable";
  if (release?.channel === "stable" && paths.checkout) {
    try {
      verifyInstalledStable(paths.checkout, paths.allowedSigners);
      releaseIntegrity = "verified";
    } catch {
      releaseIntegrity = "invalid";
    }
  }
  const advisoryFork =
    !checkout.clean ||
    !ownedRevision ||
    releaseIntegrity === "invalid" ||
    (release?.channel === "preview" &&
      ["ahead", "diverged"].includes(relationship.relation));
  return {
    installed: Boolean(installation),
    channel: release?.channel ?? "unknown",
    versions: {
      node: version(executables.node, ["--version"]),
      uv: version(executables.uv, ["--version"]),
      python: version(executables.python, ["--version"]),
      hermes: version(executables.hermes, ["--version"]),
      basic_memory: version(executables.basicMemory, ["--version"]),
    },
    services: unitState(),
    health,
    ports: { host: "127.0.0.1", ...paths.ports },
    ownership: {
      checkout:
        installation?.checkout === paths.checkout ? "owned" : "mismatch",
      installed_revision: installation?.revision ?? null,
      current_revision: checkout.head,
    },
    source: {
      clean: checkout.clean,
      cached_origin_relation: relationship,
      release_integrity: releaseIntegrity,
      advisory_fork: advisoryFork,
      update_safe: checkout.clean && !advisoryFork,
    },
    capabilities: bearer
      ? await capabilities(paths, bearer)
      : { skills: "unavailable", api_server_toolsets: "unavailable" },
    basic_memory: {
      markdown_authoritative: true,
      knowledge_present: existsSync(paths.knowledge),
      derived_index_rebuildable: existsSync(paths.knowledge),
      semantic_search: "disabled",
    },
  };
}
