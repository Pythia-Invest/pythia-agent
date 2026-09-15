import { expect, it } from "vitest";
import { readLimitedBytes } from "@/client/response-bytes";
it("bounds actual bytes when the length header is absent or inaccurate", async () => {
  for (const headers of [{}, { "content-length": "1" }]) {
    await expect(
      readLimitedBytes(new Response("too large", { headers }), 3),
    ).rejects.toThrow("too large");
  }
  expect(
    new TextDecoder().decode(await readLimitedBytes(new Response("okay"), 4)),
  ).toBe("okay");
});
