import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { referenceStatusSchema } from "@/client/reference-status";
import { ReferenceSettings } from "@/components/shell/settings-controls";

const state = vi.hoisted(() => ({ body: null as unknown }));
vi.mock("@/client/reference-status", async (original) => {
  const actual = await original<typeof import("@/client/reference-status")>();
  return {
    ...actual,
    useReferenceStatus: () => ({
      isPending: false,
      error: null,
      data: actual.referenceStatusSchema.parse(state.body),
      refetch: vi.fn(),
    }),
  };
});
vi.mock("@/client/local-time", () => ({
  useLocalTime: () => (value: string) => value,
}));

// The envelope core's `reference-status` returns (identity_ops._envelope).
const summary = {
  build_id: "reference-20260928",
  format_version: 3,
  built_at: "2026-09-28T09:00:00Z",
  as_of: "2026-09-28",
  installed_at: "2026-09-28T10:00:00Z",
  compatible: true,
  bytes: 1,
  sha256: "0".repeat(64),
  sources: [
    {
      source: "gleif_lei_records",
      url: null,
      as_of: "2026-09-28",
      licence: "CC0 1.0",
      notice: "LEI records from GLEIF under CC0 1.0.",
    },
  ],
  notices: ["LEI records from GLEIF under CC0 1.0."],
};
const refusal = {
  at: "2026-09-28T11:00:00Z",
  package: "/checkout/.local/reference-builder/out",
  message:
    "Checksum mismatch for reference-20260929.sqlite3. Nothing was installed.",
};

beforeEach(() => {
  state.body = {
    schema_version: 1,
    outcome: "ok",
    data: { installed: summary, refused: null },
  };
});

it("shows the installed build, its dates and the source notices", () => {
  const html = renderToStaticMarkup(<ReferenceSettings />);
  expect(html).toContain("reference-20260928");
  expect(html).toContain("As of 2026-09-28");
  expect(html).toContain("LEI records from GLEIF under CC0 1.0.");
  expect(html).not.toContain("refused");
});

it("shows a refused package beside the build that stays in use", () => {
  state.body = {
    schema_version: 1,
    outcome: "ok",
    data: { installed: summary, refused: refusal },
  };
  const html = renderToStaticMarkup(<ReferenceSettings />);
  expect(html).toContain(
    "A reference package was refused; reference-20260928 stays in use.",
  );
  expect(html).toContain("Checksum mismatch for reference-20260929.sqlite3.");
});

it("says when an earlier copy of the store is still beside the current one", () => {
  const earlier =
    "An earlier copy of Pythia's store is still present: /old/identity.sqlite3 (98304 bytes).";
  state.body = {
    schema_version: 1,
    outcome: "ok",
    data: { installed: summary, refused: null, both_present: earlier },
  };
  const html = renderToStaticMarkup(<ReferenceSettings />);
  expect(html).toContain(
    "An earlier copy of Pythia&#x27;s store is still on this device.",
  );
  expect(html).toContain("/old/identity.sqlite3 (98304 bytes)");
});

it("says there is no reference data, without a development-only command", () => {
  state.body = {
    schema_version: 1,
    outcome: "empty",
    data: { installed: null, refused: refusal },
    issues: [
      { code: "empty", message: "No reference data on this device yet." },
    ],
  };
  const html = renderToStaticMarkup(<ReferenceSettings />);
  expect(html).toContain("No reference data on this device yet.");
  expect(html).toContain("A reference package was refused.");
  expect(html).not.toContain("just ");
  expect(referenceStatusSchema.parse(state.body).data?.installed).toBeNull();
});
