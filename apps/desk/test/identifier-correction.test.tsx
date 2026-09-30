// @vitest-environment jsdom
import type { CorrectionView } from "@pythia/market-data/subject";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { CorrectFn } from "@/client/corrections";
import { IdentifierCorrection } from "@/components/instrument/identifier-correction";

const SECURITY = "security:isin:XS0000000009";
const correction: CorrectionView = {
  id: "c1",
  kind: "identifier",
  subject_id: SECURITY,
  scheme: "isin",
  value: "XS0000000017",
  state: "active",
};

async function show(
  onCorrect: CorrectFn | undefined,
  corrected: CorrectionView | null = null,
  subjectId: string | null = SECURITY,
) {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <IdentifierCorrection
        label="ISIN"
        scheme="isin"
        value="XS0000000009"
        subjectId={subjectId}
        corrected={corrected}
        onCorrect={onCorrect}
      />,
    ),
  );
  return { host, unmount: () => act(async () => root.unmount()) };
}

const click = (host: HTMLElement, selector: string) =>
  act(async () => host.querySelector<HTMLElement>(selector)?.click());

async function type(host: HTMLElement, text: string) {
  const input = host.querySelector("input");
  const set = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    set?.call(input, text);
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const submit = (host: HTMLElement) =>
  act(async () =>
    host
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );

it("saves the identifier the investor types, and an empty one removes it", async () => {
  const onCorrect = vi.fn(async () => "Saved.");
  const { host, unmount } = await show(onCorrect);
  await click(host, 'button[aria-label="Edit ISIN"]');
  expect(host.querySelector("input")?.value).toBe("XS0000000009");
  await type(host, " xs0000000017 ");
  await submit(host);
  expect(onCorrect).toHaveBeenLastCalledWith({
    kind: "identifier",
    subjectId: SECURITY,
    scheme: "isin",
    value: "xs0000000017",
  });
  expect(host.querySelector("form")).toBeNull(); // saved: the editor closes
  await click(host, 'button[aria-label="Edit ISIN"]');
  await type(host, "");
  await submit(host);
  expect(onCorrect).toHaveBeenLastCalledWith(
    expect.objectContaining({ value: "" }),
  );
  await unmount();
});

it("keeps the editor open with core's reason when a correction is refused", async () => {
  const onCorrect = vi.fn(async () => {
    throw new Error("isin: malformed value");
  });
  const { host, unmount } = await show(onCorrect);
  await click(host, 'button[aria-label="Edit ISIN"]');
  await type(host, "nope");
  await submit(host);
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(
    "isin: malformed value",
  );
  expect(host.querySelector("form")).not.toBeNull();
  await click(host, 'button[type="button"]'); // Cancel
  expect(host.querySelector("form")).toBeNull();
  await unmount();
});

it("says a corrected identifier was corrected by the investor and undoes it by id", async () => {
  const onCorrect = vi.fn(async () => "Undone.");
  const { host, unmount } = await show(onCorrect, correction);
  expect(host.textContent).toContain("Corrected by you");
  await click(host, 'button[aria-label="Undo the correction of ISIN"]');
  expect(onCorrect).toHaveBeenCalledWith({ action: "undo", id: "c1" });
  await unmount();
});

it("offers no edit without a way to correct or a subject the scheme identifies", async () => {
  const none = await show(undefined, correction);
  expect(none.host.textContent).toBe("Corrected by you"); // a record of it, no controls
  await none.unmount();
  const unowned = await show(vi.fn(), null, null);
  expect(unowned.host.querySelector("button")).toBeNull();
  await unowned.unmount();
});
