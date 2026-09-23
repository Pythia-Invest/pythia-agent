import { View, logger } from "vega";
import { expressionInterpreter } from "vega-interpreter";
import { createRuntime, denyLoader } from "./widgets/runtime";
import { isVisual } from "./widgets/visual";
import { assertSafeSvg } from "./widgets/svg";

export const MAX_SNAPSHOT_INPUT_BYTES = 256 * 1024;
export const MAX_SNAPSHOT_OUTPUT_BYTES = 2 * 1024 * 1024;
export const SNAPSHOT_ERROR = "Unable to render this research visual as SVG.";

/** Headless SVG only: no browser, canvas, external assets or generated code. */
export async function renderSnapshot(input: unknown): Promise<string> {
  let view: View | undefined;
  try {
    if (!isVisual(input)) throw new Error(SNAPSHOT_ERROR);
    let failed = false;
    const quiet = logger(0);
    quiet.error = () => {
      failed = true;
      return quiet;
    };
    view = new View(createRuntime(input.data.spec), {
      renderer: "none",
      loader: denyLoader,
      expr: expressionInterpreter,
      logger: quiet,
    });
    if (input.data.spec.width === "container") view.width(720);
    if (input.data.spec.height === "container") view.height(400);
    for (const [name, value] of Object.entries(input.data.parameters ?? {})) {
      view.signal(name, value);
    }
    const svg = await view.toSVG();
    if (failed || Buffer.byteLength(svg, "utf8") > MAX_SNAPSHOT_OUTPUT_BYTES) {
      throw new Error(SNAPSHOT_ERROR);
    }
    return assertSafeSvg(svg);
  } catch {
    // Compiler and expression errors may contain investor data. Never relay them.
    throw new Error(SNAPSHOT_ERROR);
  } finally {
    view?.finalize();
  }
}

/** Shared by the CLI and tests; byte limits precede JSON parsing. */
export async function renderSnapshotInput(
  input: AsyncIterable<Uint8Array>,
): Promise<string> {
  try {
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for await (const chunk of input) {
      bytes += chunk.byteLength;
      if (bytes > MAX_SNAPSHOT_INPUT_BYTES) throw new Error(SNAPSHOT_ERROR);
      chunks.push(chunk);
    }
    return await renderSnapshot(
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
    );
  } catch {
    throw new Error(SNAPSHOT_ERROR);
  }
}
