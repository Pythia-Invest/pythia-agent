import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

/** Release operator lists and decoded images after both completed and cancelled
 * operations. Native cleanup defers while another render of this page is active. */
export async function withPdfPage<T>(
  doc: PDFDocumentProxy,
  number: number,
  operation: (page: PDFPageProxy) => Promise<T>,
): Promise<T> {
  const page = await doc.getPage(number);
  try {
    return await operation(page);
  } finally {
    page.cleanup();
  }
}
