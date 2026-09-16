import { spawn } from "node:child_process";
import { dirname, isAbsolute, join } from "node:path";
import { admitBrowserRequest } from "./admission";
import { result, routeError } from "./route-utils";
import {
  isStrategyReference,
  NATIVE_SESSION_ID,
  type NativeSessionContext,
  unavailableSessionContext,
} from "@/workspace/session-context";

const MAX_OUTPUT = 8192;
const PROFILE = /^[a-z0-9][a-z0-9-]{0,63}$/u;

/** Validate the small projection; never pass through arbitrary native output. */
export function parseNativeSessionContext(
  value: unknown,
): NativeSessionContext | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (
    !["ok", "unavailable"].includes(String(record.status)) ||
    typeof record.firstInputEligible !== "boolean" ||
    !["current", "legacy", "unavailable"].includes(String(record.guidance)) ||
    !record.scope ||
    typeof record.scope !== "object"
  )
    return null;
  const scope = record.scope as Record<string, unknown>;
  if (
    record.firstInputEligible &&
    (record.status !== "ok" ||
      record.guidance !== "unavailable" ||
      scope.status !== "none")
  )
    return null;
  const base = {
    status: record.status,
    guidance: record.guidance,
    firstInputEligible: record.firstInputEligible,
  } as Pick<NativeSessionContext, "status" | "guidance" | "firstInputEligible">;
  if (scope.status === "none") return { ...base, scope: { status: "none" } };
  if (scope.status === "resolved" && isStrategyReference(scope.reference))
    return {
      ...base,
      scope: { status: "resolved", reference: scope.reference },
    };
  if (
    scope.status === "unresolved" &&
    typeof scope.reason === "string" &&
    /^[a-z_]{1,64}$/u.test(scope.reason)
  )
    return { ...base, scope: { status: "unresolved", reason: scope.reason } };
  return null;
}

/** Call only after Desk admission. Paths and environment are server-owned. */
export function createNativeSessionContextReader(
  environment: NodeJS.ProcessEnv = process.env,
) {
  return async (
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<NativeSessionContext> => {
    if (!NATIVE_SESSION_ID.test(sessionId))
      return unavailableSessionContext("invalid_request");
    const {
      HERMES_HOME: home,
      PYTHIA_HERMES_PROFILE: profile,
      PYTHIA_HERMES_EXECUTABLE: executable,
      PYTHIA_MANAGED_ROOT: managed,
    } = environment;
    if (
      !home ||
      !isAbsolute(home) ||
      !profile ||
      !PROFILE.test(profile) ||
      !executable ||
      !isAbsolute(executable) ||
      !managed ||
      !isAbsolute(managed)
    )
      return unavailableSessionContext("profile_unavailable");
    if (signal?.aborted) return unavailableSessionContext("cancelled");
    const db =
      profile === "default"
        ? join(home, "state.db")
        : join(home, "profiles", profile, "state.db");
    const childEnvironment: NodeJS.ProcessEnv = {
      NODE_ENV: environment.NODE_ENV ?? "production",
      HERMES_HOME: home,
      HERMES_DISABLE_LAZY_INSTALLS: "1",
      PYTHONDONTWRITEBYTECODE: "1",
      PYTHONIOENCODING: "utf-8",
    };
    for (const name of ["HOME", "PATH", "LANG", "LC_ALL", "TMPDIR"])
      if (environment[name]) childEnvironment[name] = environment[name];
    return new Promise((resolve) => {
      const child = spawn(
        join(dirname(executable), "python"),
        [
          "-B",
          join(managed, "runner", "native_session_context.py"),
          "--db",
          db,
        ],
        { env: childEnvironment, stdio: ["pipe", "pipe", "pipe"] },
      );
      const output: Buffer[] = [];
      let bytes = 0;
      let failure: string | undefined;
      const stop = (reason: string) => {
        failure ??= reason;
        child.kill("SIGKILL");
      };
      const abort = () => stop("cancelled");
      const timer = setTimeout(() => stop("deadline"), 3000);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      child.stdout.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_OUTPUT) stop("output_limit");
        else output.push(chunk);
      });
      // Drain bounded diagnostic output without exposing local paths/prompts.
      child.stderr.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_OUTPUT) stop("output_limit");
      });
      child.on("error", () => {
        failure ??= "native_read_failed";
      });
      child.stdin.on("error", () => {
        failure ??= "native_read_failed";
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        if (failure || code !== 0) {
          resolve(unavailableSessionContext(failure ?? "native_read_failed"));
          return;
        }
        try {
          resolve(
            parseNativeSessionContext(
              JSON.parse(Buffer.concat(output).toString("utf8")),
            ) ?? unavailableSessionContext("invalid_native_result"),
          );
        } catch {
          resolve(unavailableSessionContext("invalid_native_result"));
        }
      });
      child.stdin.end(JSON.stringify({ sessionId }));
    });
  };
}

export function createNativeSessionContextRoutes(
  read = createNativeSessionContextReader(),
) {
  return {
    async sessionContext(
      request: Request,
      context: { params: Promise<Record<string, string>> },
    ) {
      const rejection = admitBrowserRequest(request, "read");
      if (rejection) return rejection;
      try {
        const { sessionId } = await context.params;
        return result(await read(sessionId ?? "", request.signal));
      } catch (error) {
        return routeError(error);
      }
    },
  };
}
