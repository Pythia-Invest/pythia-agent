import { existsSync, readFileSync } from "node:fs";

const path = ".github/workflows/deterministic.yml";
if (!existsSync(path)) {
  throw new Error(`${path} is required`);
}

const workflow = readFileSync(path, "utf8");
const required = [
  "macos-14",
  "ubuntu-24.04",
  "extractions/setup-just@53165ef7e734c5c07cb06b3c8e7b647c5aa16db3",
  "just-version: 1.46.0",
  "astral-sh/setup-uv@v5",
  "version: 0.9.28",
  "just bootstrap",
  "just check",
  "just test",
  "just audit",
  "permissions:\n  contents: read",
];
const forbidden = [
  "secrets.",
  "aws",
  "ssm",
  "postgres",
  "pg-boss",
  "terraform",
  "docker",
  "systemctl",
];

for (const value of required) {
  if (!workflow.includes(value)) {
    throw new Error(`${path} must contain ${JSON.stringify(value)}`);
  }
}
for (const value of forbidden) {
  if (workflow.toLowerCase().includes(value)) {
    throw new Error(`${path} must not contain ${JSON.stringify(value)}`);
  }
}
