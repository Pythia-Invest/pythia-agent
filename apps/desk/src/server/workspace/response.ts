import { describe, failure, type fileBoundary } from "./files";

export async function fileResponse(
  boundary: ReturnType<typeof fileBoundary>,
  path: string,
  request: Request,
) {
  request.signal.throwIfAborted();
  const file = await boundary.file(path);
  try {
    const entry = await describe(path, file.stat, file.handle);
    await file.check();
    const expectedRevision = new URL(request.url).searchParams.get("revision");
    if (
      expectedRevision !== null &&
      (expectedRevision.length > 256 || expectedRevision !== entry.revision)
    ) {
      throw failure(
        "workspace_changed",
        "The file changed since it was opened. Reopen it.",
        409,
      );
    }
    const download =
      new URL(request.url).searchParams.get("download") === "true" ||
      !entry.previewable;
    let start = 0,
      end = file.stat.size - 1;
    const range = request.headers.get("range");
    async function invalidRange() {
      await file.handle.close();
      return Response.json(
        {
          error: {
            code: "workspace_range",
            message: "Unsupported or unsatisfiable byte range.",
          },
        },
        {
          status: 416,
          headers: {
            "Content-Range": `bytes */${file.stat.size}`,
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          },
        },
      );
    }
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) return invalidRange();
      start = match[1]
        ? Number(match[1])
        : Math.max(0, file.stat.size - Number(match[2]));
      end = match[1] && match[2] ? Math.min(end, Number(match[2])) : end;
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start > end ||
        start >= file.stat.size
      )
        return invalidRange();
    }
    const inlinePdf = entry.kind === "pdf" && !download;
    const headers = new Headers({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": `default-src 'none'; sandbox; frame-ancestors '${inlinePdf ? "self" : "none"}'`,
      "X-Frame-Options": inlinePdf ? "SAMEORIGIN" : "DENY",
      "Referrer-Policy": "no-referrer",
      "Accept-Ranges": "bytes",
      "Content-Type": entry.mediaType,
      "Content-Length": String(Math.max(0, end - start + 1)),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(entry.name).replace(/'/g, "%27")}`,
      "X-Workspace-Revision": entry.revision,
    });
    if (range)
      headers.set("Content-Range", `bytes ${start}-${end}/${file.stat.size}`);
    let closed = false;
    const close = async () => {
      if (!closed) {
        closed = true;
        request.signal.removeEventListener("abort", abort);
        await file.handle.close();
      }
    };
    const abort = () => {
      void close();
    };
    request.signal.addEventListener("abort", abort, { once: true });
    if (request.method === "HEAD") {
      await close();
      return new Response(null, { status: range ? 206 : 200, headers });
    }
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          request.signal.throwIfAborted();
          await file.check();
          if (start > end) {
            await close();
            controller.close();
            return;
          }
          const buffer = Buffer.alloc(Math.min(64 * 1024, end - start + 1));
          const { bytesRead } = await file.handle.read(
            buffer,
            0,
            buffer.length,
            start,
          );
          await file.check();
          if (bytesRead !== buffer.length)
            throw failure(
              "workspace_changed",
              "The file changed while being read.",
              409,
            );
          start += bytesRead;
          controller.enqueue(buffer);
        } catch (error) {
          await close();
          controller.error(error);
        }
      },
      cancel: close,
    });
    return new Response(stream, { status: range ? 206 : 200, headers });
  } catch (error) {
    await file.handle.close();
    throw error;
  }
}
