import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActivityIndicator } from "../src/feedback/activity";
import { Alert } from "../src/feedback/alert";
import { Badge } from "../src/feedback/badge";
import { Progress } from "../src/feedback/progress";
import { Skeleton } from "../src/feedback/skeleton";
import { pythiaToast } from "../src/feedback/toast";

describe("feedback components", () => {
  it("labels alert and badge meanings in markup rather than relying on color", () => {
    const warning = renderToStaticMarkup(
      <Alert tone="warning" title="Review required">
        One source is incomplete.
      </Alert>,
    );
    const error = renderToStaticMarkup(
      <Alert tone="error" title="Export failed" />,
    );
    const badge = renderToStaticMarkup(<Badge tone="success">Current</Badge>);

    expect(warning).toContain('role="status"');
    expect(warning).toContain('data-tone="warning"');
    expect(warning).toContain("Review required");
    expect(error).toContain('role="alert"');
    expect(badge).toContain('data-tone="success"');
    expect(badge).toContain("Current");
  });

  it("keeps determinate progress separate from unquantified activity", () => {
    const progress = renderToStaticMarkup(
      <Progress label="Import sources" value={37} />,
    );
    const activity = renderToStaticMarkup(
      <ActivityIndicator label="Checking sources" />,
    );

    expect(progress).toContain('role="progressbar"');
    expect(progress).toContain('aria-valuenow="37"');
    expect(progress).toContain(
      'style="inset-inline-start:0;height:inherit;width:37%"',
    );
    expect(activity).toContain('role="status"');
    expect(activity).toContain("Checking sources");
    expect(activity).not.toMatch(/\d+%|aria-valuenow/);
  });

  it("keeps skeletons decorative and exposes shape without announcing fake progress", () => {
    const skeleton = renderToStaticMarkup(
      <Skeleton aria-hidden={false} shape="circle" />,
    );
    expect(skeleton).toContain('aria-hidden="true"');
    expect(skeleton).toContain('data-shape="circle"');
    expect(skeleton).not.toContain("progressbar");
  });

  it("uses one native Base UI manager and one native provider/portal/viewport queue", async () => {
    const source = await readFile(
      new URL("../src/feedback/toast.tsx", import.meta.url),
      "utf8",
    );

    expect(source.match(/BaseToast\.createToastManager\(\)/g)).toHaveLength(1);
    expect(source.match(/<BaseToast\.Provider/g)).toHaveLength(1);
    expect(source.match(/<BaseToast\.Portal/g)).toHaveLength(1);
    expect(source.match(/<BaseToast\.Viewport/g)).toHaveLength(1);
    expect(source).toContain("const { toasts } = BaseToast.useToastManager()");
    expect(source).toContain("toast.actionProps");
    expect(source.match(/<BaseToast\.Action/g)).toHaveLength(1);
    expect(source).not.toMatch(/useState|useReducer|customQueue/);
  });

  it("exposes distinct semantic facade paths while retaining native ids and promise", async () => {
    const ids = [
      pythiaToast.info({ title: "Information" }),
      pythiaToast.success({
        actionProps: { children: "Undo", onClick: () => undefined },
        title: "Saved",
      }),
      pythiaToast.warning({ title: "Review" }),
      pythiaToast.error({ title: "Failed", priority: "high" }),
    ];

    expect(new Set(ids).size).toBe(4);
    pythiaToast.update(ids[0] ?? "", {
      tone: "success",
      title: "Updated",
    });
    pythiaToast.close(ids[1]);
    await expect(
      pythiaToast.promise(Promise.resolve("done"), {
        loading: { title: "Working" },
        success: (value) => ({ title: value }),
        error: { title: "Failed" },
      }),
    ).resolves.toBe("done");
    pythiaToast.close();
  });
});
