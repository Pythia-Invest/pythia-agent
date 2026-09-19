import { spawn } from "node:child_process";
import { once } from "node:events";

/** Own only this qualification's child processes, including interrupted builds. */
export function createQualificationProcesses(signal) {
  const children = new Set();

  function child(file, args, options = {}) {
    const running = spawn(file, args, { ...options, signal });
    children.add(running);
    running.once("exit", () => children.delete(running));
    return running;
  }

  async function command(file, args, options) {
    const running = child(file, args, options);
    const [code] = await once(running, "exit");
    if (code !== 0) throw new Error(`${file} failed with exit ${code}`);
  }

  async function close() {
    for (const running of children) {
      const exited = once(running, "exit").catch(() => {});
      running.kill("SIGTERM");
      const timer = setTimeout(() => running.kill("SIGKILL"), 5_000);
      timer.unref();
      await exited;
      clearTimeout(timer);
    }
  }

  return { child, command, close };
}
