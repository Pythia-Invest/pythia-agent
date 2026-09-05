import { join } from "node:path";

const SENSITIVE_NAME =
  /(?:^|_)(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?|EDGAR_IDENTITY)(?:_|$)/iu;

export function redactedEnvironment(source = process.env) {
  const clean = {};
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined || SENSITIVE_NAME.test(name)) continue;
    clean[name] = value;
  }
  return clean;
}

export function runtimeEnvironment(paths, apiKey, source = process.env) {
  return {
    ...redactedEnvironment(source),
    HERMES_HOME: paths.hermesRoot,
    HERMES_DISABLE_LAZY_INSTALLS: "1",
    PYTHIA_CONFIG_ROOT: paths.configRoot,
    PYTHIA_STATE_ROOT: paths.stateRoot,
    PYTHIA_MANAGED_ROOT: paths.managedRoot,
    PYTHIA_EDGAR_DATA_DIR: paths.edgarData,
    PYTHIA_EDGAR_CACHE_DIR: paths.edgarCache,
    PYTHIA_PYTHON: join(paths.managedPython, ".venv", "bin", "python"),
    PYTHIA_NODE: process.execPath,
    PYTHIA_HERMES_EXECUTABLE: join(
      paths.hermesSource,
      ".venv",
      "bin",
      "hermes",
    ),
    PYTHIA_HERMES_PROFILE: paths.profile,
    PYTHIA_DEV_LIFECYCLE_CLI: join(
      paths.repositoryRoot,
      "scripts",
      "dev",
      "cli.mjs",
    ),
    API_SERVER_HOST: "127.0.0.1",
    API_SERVER_PORT: String(paths.ports.hermes),
    API_SERVER_KEY: apiKey,
    PYTHIA_HERMES_API_URL: `http://127.0.0.1:${paths.ports.hermes}`,
    PYTHIA_BASIC_MEMORY_MCP_URL: `http://127.0.0.1:${paths.ports.memory}/mcp`,
    PYTHIA_MANAGED_SKILLS_DIR: paths.managedSkills,
    PYTHIA_WORKSPACE: paths.workspace,
    BASIC_MEMORY_CONFIG_DIR: paths.basicMemoryConfig,
    BASIC_MEMORY_NO_PROMOS: "true",
    BASIC_MEMORY_SEMANTIC_SEARCH_ENABLED: "false",
    FASTMCP_CHECK_FOR_UPDATES: "off",
    FASTMCP_SHOW_SERVER_BANNER: "false",
    HF_HOME: `${paths.basicMemoryCache}/huggingface-disabled`,
    FASTEMBED_CACHE_PATH: `${paths.basicMemoryCache}/fastembed-disabled`,
    XDG_CACHE_HOME: paths.cacheRoot,
    NEXT_TELEMETRY_DISABLED: "1",
    PORT: String(paths.ports.desk),
    HOSTNAME: "127.0.0.1",
  };
}

export function publicEnvironmentSummary(environment) {
  return Object.fromEntries(
    Object.entries(environment).map(([name, value]) => [
      name,
      SENSITIVE_NAME.test(name) ? "<redacted>" : value,
    ]),
  );
}
