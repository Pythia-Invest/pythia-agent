#!/usr/bin/env node
import { spawn } from "node:child_process";

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("Pythia service owner received no command.");
  process.exit(64);
}

const child = spawn(command, args, {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
});
child.once("error", (error) => {
  console.error(`Pythia could not start ${command}: ${error.message}`);
  process.exit(127);
});
child.once("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
