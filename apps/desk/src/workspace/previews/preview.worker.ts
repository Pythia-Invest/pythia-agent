import { parsePreview } from "./parse";
import type { ParseInput } from "./formats";
self.onmessage = async (event: MessageEvent<ParseInput>) => {
  try {
    self.postMessage({ result: await parsePreview(event.data) });
  } catch {
    self.postMessage({
      error:
        "Preview unavailable for this file. It may be damaged, encrypted, or exceed preview limits.",
    });
  }
};
