import { expect, test } from "vitest";
import { providerFailure } from "../managed/runner/provider-errors.js";

test("numeric HTTP failures and local admission delays retain safe distinct meanings", () => {
  const provider = providerFailure(
    Object.assign(Error("private upstream body"), { code: 429 }),
  );
  expect(provider).toMatchObject({ code: "rate_limit", origin: "provider" });
  const local = providerFailure(
    Object.assign(Error("private request"), {
      code: "busy",
      origin: "connector",
      retry_after_seconds: 1,
    }),
  );
  expect(local).toMatchObject({
    code: "busy",
    origin: "connector",
    retry_after_seconds: 1,
  });
  expect(JSON.stringify([provider, local])).not.toContain("private");
  expect(
    providerFailure(Object.assign(Error("secret"), { status: 403 })),
  ).toMatchObject({ code: "access_denied" });
});
