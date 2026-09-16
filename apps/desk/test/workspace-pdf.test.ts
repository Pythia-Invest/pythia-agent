import { expect, it, vi } from "vitest";
import * as pdf from "pdfjs-dist/legacy/build/pdf.mjs";
import { withPdfPage } from "@/workspace/previews/pdf-page";
import { imagePdfBytes } from "./workspace-pdf-fixtures";

it("releases decoded image data after completed and cancelled page renders", async () => {
  const loading = pdf.getDocument({ data: imagePdfBytes() });
  try {
    const doc = await loading.promise;
    // PDF.js types expose the configured canvas factory only as Object.
    const factory = doc.canvasFactory as {
      create(width: number, height: number): { canvas: HTMLCanvasElement };
      destroy(value: { canvas: HTMLCanvasElement }): void;
    };
    const canvas = factory.create(128, 128);
    try {
      for (let number = 1; number <= 6; number++) {
        const page = await doc.getPage(number);
        const ops = await page.getOperatorList();
        const imageId =
          ops.argsArray[ops.fnArray.indexOf(pdf.OPS.paintImageXObject)][0];
        const render = withPdfPage(doc, number, async (page) => {
          const task = page.render({
            canvas: canvas.canvas,
            viewport: page.getViewport({ scale: 1 }),
          });
          if (number % 2 === 0) task.cancel();
          await task.promise;
        });
        if (number % 2 === 0)
          await expect(render).rejects.toMatchObject({
            name: "RenderingCancelledException",
          });
        else await render;
        // Public page object storage must no longer retain the decoded image.
        await vi.waitFor(() => expect(page.objs.has(imageId)).toBe(false));
      }
    } finally {
      factory.destroy(canvas);
    }
  } finally {
    await loading.destroy();
  }
});
