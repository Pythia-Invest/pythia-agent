import { expect, type Page, test } from "@playwright/test";
import { fixture } from "./stream-fixture";

/**
 * For a spec whose tests all run on the synthetic Desk. Each test gets the
 * fixture before its own routes, so those take precedence, and fails if a
 * request went unanswered (none reaches Hermes). Call it once, at the top of
 * the spec.
 */
export function useSyntheticDesk() {
  const desks = new WeakMap<Page, Awaited<ReturnType<typeof fixture>>>();
  test.beforeEach(async ({ page }) => {
    desks.set(page, await fixture(page));
  });
  test.afterEach(async ({ page }) => {
    expect(desks.get(page)?.unexpected).toEqual([]);
  });
}
