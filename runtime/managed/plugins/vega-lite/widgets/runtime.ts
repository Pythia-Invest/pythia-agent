import { parse, logger, type Loader } from "vega";
import { compile } from "vega-lite";
import { validateSpec } from "./visual";
import { assertSafeRuntime } from "./expression-safety";
const deny = async (): Promise<never> => {
  throw new Error("Research visuals cannot load external resources.");
};
export const denyLoader: Loader = {
  load: deny,
  sanitize: deny,
  http: deny,
  file: deny,
};
export function createRuntime(
  spec: Record<string, unknown>,
  interactive = true,
) {
  if (!validateSpec(spec))
    throw new Error("Unsupported or unsafe visualization specification.");
  const compiled = compile(structuredClone(spec), {
    logger: logger(0),
  }).spec;
  if (!interactive) {
    const removeEvents = (value: unknown): void => {
      if (Array.isArray(value)) {
        for (const child of value) removeEvents(child);
      } else if (value && typeof value === "object") {
        const object = value as Record<string, unknown>;
        if (Array.isArray(object.signals))
          for (const signal of object.signals) {
            // Keep reactive signal/scale dependencies; only DOM event streams
            // and binding elements are inappropriate for a detached snapshot.
            if (Array.isArray(signal.on))
              signal.on = signal.on.flatMap((handler: { events?: unknown }) => {
                const events = (
                  Array.isArray(handler.events)
                    ? handler.events
                    : [handler.events]
                ).filter(
                  (event) =>
                    event &&
                    typeof event === "object" &&
                    (Object.hasOwn(event, "signal") ||
                      Object.hasOwn(event, "scale")),
                );
                return events.length ? [{ ...handler, events }] : [];
              });
            delete signal.bind;
          }
        for (const child of Object.values(object)) removeEvents(child);
      }
    };
    removeEvents(compiled);
  }
  const runtime = parse(compiled, {}, { ast: true });
  assertSafeRuntime(runtime);
  return runtime;
}
