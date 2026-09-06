import { readFileSync, existsSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import { runtimeEnvironment } from "../scripts/dev/environment.mjs";
import {
  MANAGED_PLUGIN_FILES,
  MANAGED_PYTHON_SOURCE_FILES,
} from "../scripts/dev/files.mjs";
import { resolveInstallPaths } from "../scripts/install/paths.mjs";
import {
  renderUnits,
  serviceEnvironments,
  UNIT_NAMES,
} from "../scripts/install/systemd.mjs";
import { sourceManifest } from "./source-snapshot.mjs";

import {
  forbiddenPayloadText,
  isBuilderInstructionSource,
  normalized,
  rejectSourcePath,
  root,
  violations,
  walk,
} from "./runtime-closure-policy.mjs";

const syntheticEnvironment = {
  HOME: "/home/pythia-test",
  PYTHIA_CHECKOUT: root,
  PYTHIA_INSTALL_BIN_HOME: "/home/pythia-test/.local/bin",
  PYTHIA_INSTALL_CACHE_HOME: "/home/pythia-test/.cache",
  PYTHIA_INSTALL_CONFIG_HOME: "/home/pythia-test/.config",
  PYTHIA_INSTALL_DATA_HOME: "/home/pythia-test/.local/share",
  PYTHIA_INSTALL_STATE_HOME: "/home/pythia-test/.local/state",
  PYTHIA_INSTALL_SYSTEMD_HOME: "/home/pythia-test/.config/systemd/user",
};
const paths = resolveInstallPaths(syntheticEnvironment);
const executables = {
  node: `${paths.runtimeRoot}/node/22.16.0/bin/node`,
  python: `${paths.runtimeRoot}/python/python3.12`,
  managedPython: `${paths.managedPython}/.venv/bin/python`,
  uv: `${paths.runtimeRoot}/uv/0.9.28/uv`,
  hermes: `${paths.hermesSource}/.venv/bin/hermes`,
  basicMemory: `${paths.managedPython}/.venv/bin/basic-memory`,
  next: `${paths.checkout}/apps/desk/node_modules/next/dist/bin/next`,
};
const previousHome = process.env.HOME;
process.env.HOME = syntheticEnvironment.HOME;
const installedEnvironments = serviceEnvironments(paths, executables);
if (previousHome === undefined) delete process.env.HOME;
else process.env.HOME = previousHome;
const units = renderUnits(paths, executables);
const unitPayload = Object.values(units).join("\n");

if (
  Object.keys(units).sort().join("\0") !== [...UNIT_NAMES].sort().join("\0")
) {
  violations.push(
    "systemd: rendered unit set differs from the four-file allowlist",
  );
}
for (const text of forbiddenPayloadText) {
  if (unitPayload.includes(text)) violations.push(`systemd: contains ${text}`);
}
if (unitPayload.includes("CLOSURE_CANARY_SECRET")) {
  violations.push("systemd: embeds the private service bearer");
}
const expectedUnitFragments = [
  `WorkingDirectory=${paths.workspace}\n`,
  `ExecStart="${executables.python}" "${paths.serviceLauncher}" hermes "${executables.hermes}" -p pythia gateway run --external-supervisor`,
  `ExecStart="${executables.basicMemory}" mcp --transport streamable-http --host 127.0.0.1`,
  `WorkingDirectory=${join(paths.checkout, "apps", "desk")}\n`,
  `ExecStart="${executables.python}" "${paths.serviceLauncher}" desk "${executables.node}" "${executables.next}" start --hostname 127.0.0.1 --port 8644`,
];
for (const fragment of expectedUnitFragments) {
  if (!unitPayload.includes(fragment)) {
    violations.push(`systemd: missing exact runtime fragment ${fragment}`);
  }
}
for (const [role, environment] of Object.entries(installedEnvironments)) {
  if (
    environment.includes("CLOSURE_CANARY_SECRET") ||
    environment.includes("API_SERVER_KEY=")
  ) {
    violations.push(`service environment ${role}: embeds the private bearer`);
  }
  const pathLine = environment
    .split("\n")
    .find((line) => line.startsWith("PATH="));
  if (!pathLine || pathLine.includes(paths.checkout)) {
    violations.push(
      `service environment ${role}: checkout entered executable PATH`,
    );
  }
}
const basicMemoryEnvironmentNames = installedEnvironments.basicMemory
  .trim()
  .split("\n")
  .map((line) => line.slice(0, line.indexOf("=")))
  .sort((left, right) => left.localeCompare(right, "en"));
const expectedBasicMemoryEnvironmentNames = [
  "BASIC_MEMORY_CONFIG_DIR",
  "BASIC_MEMORY_NO_PROMOS",
  "BASIC_MEMORY_SEMANTIC_SEARCH_ENABLED",
  "FASTEMBED_CACHE_PATH",
  "FASTMCP_CHECK_FOR_UPDATES",
  "FASTMCP_SHOW_SERVER_BANNER",
  "HF_HOME",
  "HOME",
  "PATH",
  "XDG_CACHE_HOME",
].sort((left, right) => left.localeCompare(right, "en"));
if (
  basicMemoryEnvironmentNames.join("\0") !==
  expectedBasicMemoryEnvironmentNames.join("\0")
) {
  violations.push(
    "service environment basicMemory: differs from the exact Basic Memory allowlist",
  );
}

const developmentPaths = {
  ...paths,
  repositoryRoot: paths.checkout,
  id: "qualification",
  managedRoot: `${paths.checkout}/runtime/managed`,
  managedSkills: `${paths.checkout}/runtime/managed/skills`,
  managedPlugin: `${paths.checkout}/runtime/managed/plugin`,
};
const nativeEnvironment = runtimeEnvironment(
  developmentPaths,
  "CLOSURE_CANARY_SECRET",
  syntheticEnvironment,
);
if (
  nativeEnvironment.PYTHIA_MANAGED_SKILLS_DIR !== developmentPaths.managedSkills
) {
  violations.push(
    "Hermes: managed skill scan root is not the exact managed skills directory",
  );
}
for (const name of [
  "PYTHIA_WORKSPACE",
  "HERMES_HOME",
  "BASIC_MEMORY_CONFIG_DIR",
]) {
  if (String(nativeEnvironment[name]).startsWith(`${paths.checkout}/`)) {
    violations.push(`runtime environment: ${name} points into public source`);
  }
}

const source = sourceManifest(root);
const pluginFiles = source.entries
  .map((item) => item.path)
  .filter((path) => path.startsWith("runtime/managed/plugin/"));
if (
  pluginFiles.join("\0") !==
  [...MANAGED_PLUGIN_FILES.map((path) => `runtime/managed/plugin/${path}`)]
    .sort((left, right) => left.localeCompare(right, "en"))
    .join("\0")
) {
  violations.push(
    "Hermes: managed plugin source is not the exact two-file allowlist",
  );
}
const managedPythonFiles = source.entries
  .map((item) => item.path)
  .filter((path) => path.startsWith("runtime/managed/python/"));
if (
  managedPythonFiles.join("\0") !==
  [
    ...MANAGED_PYTHON_SOURCE_FILES.map(
      (path) => `runtime/managed/python/${path}`,
    ),
  ]
    .sort((left, right) => left.localeCompare(right, "en"))
    .join("\0")
) {
  violations.push(
    "installer: managed Python inputs are not the exact four-file allowlist",
  );
}

const skillFiles = source.entries
  .map((item) => item.path)
  .filter((path) => path.startsWith("runtime/managed/skills/"));
const skillRoots = new Set();
for (const path of skillFiles) {
  const relativeSkillPath = path.slice("runtime/managed/skills/".length);
  const [skill, ...supportingPath] = relativeSkillPath.split("/");
  if (!skill || supportingPath.length === 0) {
    violations.push(
      `Hermes: managed skill source is not inside a bundle: ${path}`,
    );
    continue;
  }
  skillRoots.add(skill);
}
for (const skill of skillRoots) {
  const entrypoint = `runtime/managed/skills/${skill}/SKILL.md`;
  if (!skillFiles.includes(entrypoint)) {
    violations.push(`Hermes: managed skill bundle lacks ${entrypoint}`);
  }
}
const authoritativePromptSource = "runtime/managed/plugin/__init__.py";
const retiredPromptSource = "runtime/managed/instructions/operating.md";
const managedReadme = readFileSync(
  join(root, "runtime/managed/README.md"),
  "utf8",
);
if (!managedReadme.includes(`\`${authoritativePromptSource}\``)) {
  violations.push(
    `managed runtime: README does not name ${authoritativePromptSource} as the prompt source`,
  );
}
if (source.entries.some((entry) => entry.path === retiredPromptSource)) {
  violations.push(
    `managed runtime: duplicate prompt authority remains at ${retiredPromptSource}`,
  );
}
const unconditionalPromptSources = [
  authoritativePromptSource,
  "runtime/seeds/profile/SOUL.md",
];
for (const path of unconditionalPromptSources) {
  const content = readFileSync(join(root, path), "utf8");
  if (
    content.includes("Basic Memory") ||
    content.includes("mcp-basic-memory")
  ) {
    violations.push(
      `prompt source ${path}: unconditional guidance names an optional capability`,
    );
  }
}
const memorySkill = readFileSync(
  join(root, "runtime/managed/skills/investment-memory/SKILL.md"),
  "utf8",
);
if (
  !memorySkill.includes("requires_toolsets: [mcp-basic-memory]") ||
  !memorySkill.includes("Basic Memory")
) {
  violations.push(
    "Hermes: Basic Memory guidance is not confined to its natively gated skill",
  );
}
const promptAndContextFiles = new Set([
  authoritativePromptSource,
  ...skillFiles,
]);
const installedRuntimeFiles = new Set([
  ...MANAGED_PLUGIN_FILES.map((path) => `runtime/managed/plugin/${path}`),
  ...MANAGED_PYTHON_SOURCE_FILES.map(
    (path) => `runtime/managed/python/${path}`,
  ),
  "runtime/managed/basic-memory/mcp.yaml",
  "runtime/managed/basic-memory/service.environment",
  "runtime/managed/runner/eodhd.ts",
  "runtime/managed/runner/sec.py",
  "runtime/managed/runner/tsconfig.json",
  "runtime/seeds/manifest.json",
  ...promptAndContextFiles,
]);
for (const path of installedRuntimeFiles) {
  if (!source.entries.some((entry) => entry.path === path)) {
    violations.push(`runtime input: missing source ${path}`);
    continue;
  }
  const content = readFileSync(join(root, path), "utf8");
  for (const text of forbiddenPayloadText) {
    if (content.includes(text))
      violations.push(`runtime input ${path}: contains ${text}`);
  }
}

const seedManifest = JSON.parse(
  readFileSync(join(root, "runtime/seeds/manifest.json"), "utf8"),
);
if (
  seedManifest.policy !== "create-if-absent" ||
  !Array.isArray(seedManifest.entries)
) {
  violations.push("seeds: manifest is invalid or not create-if-absent");
} else {
  const requiredSeedDestinations = new Set([
    "workspace/AGENTS.md",
    "workspace/DATA_SOURCES.md",
    "workspace/portfolio/README.md",
    "workspace/cases/README.md",
    "workspace/scratch/README.md",
  ]);
  for (const seed of seedManifest.entries) {
    const sourcePath = `runtime/seeds/${String(seed.source)}`;
    const path = join(root, sourcePath);
    installedRuntimeFiles.add(sourcePath);
    promptAndContextFiles.add(sourcePath);
    rejectSourcePath(path, "seed manifest");
    const content = readFileSync(path, "utf8");
    for (const text of forbiddenPayloadText) {
      if (content.includes(text)) {
        violations.push(`seed ${seed.source}: contains ${text}`);
      }
    }
    requiredSeedDestinations.delete(seed.destination);
  }
  for (const destination of requiredSeedDestinations) {
    violations.push(
      `seeds: missing starter workspace destination ${destination}`,
    );
  }
}

for (const path of installedRuntimeFiles) {
  if (isBuilderInstructionSource(path)) {
    violations.push(`runtime input: includes builder guidance ${path}`);
  }
}

const nextRoot = join(root, "apps/desk/.next");
if (!existsSync(join(nextRoot, "BUILD_ID"))) {
  violations.push(
    "Desk: production Next output is missing; run the build first",
  );
} else {
  for (const path of walk(nextRoot).filter((value) =>
    value.endsWith(".nft.json"),
  )) {
    const trace = JSON.parse(readFileSync(path, "utf8"));
    for (const value of trace.files ?? []) {
      const target = resolve(join(path, ".."), value);
      if (
        target.startsWith(`${root}${sep}`) &&
        !target.includes(`${sep}node_modules${sep}`)
      ) {
        rejectSourcePath(target, normalized(relative(root, path)));
      }
    }
  }
  const productionOutput = [join(nextRoot, "server"), join(nextRoot, "static")];
  for (const path of productionOutput.flatMap(walk)) {
    if (extname(path) === ".map") {
      violations.push(
        `Desk: production source map is present at ${relative(root, path)}`,
      );
      continue;
    }
    const bytes = readFileSync(path);
    if (bytes.includes(0)) continue;
    const content = bytes.toString("utf8");
    for (const text of forbiddenPayloadText) {
      if (content.includes(text)) {
        violations.push(
          `Desk output ${relative(root, path)}: contains ${text}`,
        );
      }
    }
    if (content.includes("CLOSURE_CANARY_SECRET")) {
      violations.push(
        `Desk output ${relative(root, path)}: contains a service secret`,
      );
    }
  }
}

if (violations.length > 0) {
  throw new Error(`Runtime closure check failed:\n${violations.join("\n")}`);
}

console.log(
  `Runtime closure check passed (${source.entries.length} source files; ${skillRoots.size} managed skills).`,
);
