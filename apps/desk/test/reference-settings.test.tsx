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
const installed = {
  schema_version: 1,
  outcome: "ok",
  data: {
    build_id: "reference-20260928",
    format_version: 2,
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
    previous: {
      build_id: "reference-20260926",
      format_version: 2,
      built_at: "2026-09-26T09:00:00Z",
      as_of: "2026-09-26",
    },
  },
};

beforeEach(() => {
  state.body = installed;
});

it("shows the installed build, its dates, the kept previous build and the source notices", () => {
  const html = renderToStaticMarkup(<ReferenceSettings />);
  expect(html).toContain("reference-20260928");
  expect(html).toContain("As of 2026-09-28");
  expect(html).toContain(
    "reference-20260926, as of 2026-09-26. Kept for rollback.",
  );
  expect(html).toContain("LEI records from GLEIF under CC0 1.0.");
});

it("says how to install when the device has no reference package", () => {
  state.body = {
    schema_version: 1,
    outcome: "empty",
    data: null,
    issues: [
      { code: "unavailable", message: "No reference data on this device yet." },
    ],
  };
  const html = renderToStaticMarkup(<ReferenceSettings />);
  expect(html).toContain("No reference data on this device yet.");
  expect(html).toContain("just reference-install");
  expect(referenceStatusSchema.parse(state.body).data).toBeNull();
});
