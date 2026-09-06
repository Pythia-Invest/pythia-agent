import {
  assertMcpDiagnostics,
  assertMcpProject,
  assertTextSearch,
  childExited,
  initializeMcp,
  mcpPost,
  verifyBasicMemoryMarker,
  verifyBasicMemoryNativeProject,
} from "./basic-memory-protocol.mjs";

const PROTOCOL_VERSION = "2025-06-18";

export {
  verifyBasicMemoryMarker,
  verifyBasicMemoryNativeProject,
} from "./basic-memory-protocol.mjs";

export async function verifyBasicMemoryReadiness(paths, options) {
  const expected = verifyBasicMemoryMarker(paths);
  const fetcher = options.fetch ?? fetch;
  const { url, sessionId } = await initializeMcp(
    paths,
    options.child,
    fetcher,
    options.timeout ?? 45_000,
  );
  verifyBasicMemoryNativeProject(
    paths,
    options.executable,
    options.environment,
    { run: options.run },
  );
  try {
    await mcpPost(
      fetcher,
      url,
      {
        jsonrpc: "2.0",
        method: "notifications/initialized",
      },
      sessionId,
    );
    const listed = await mcpPost(
      fetcher,
      url,
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      sessionId,
    );
    const names = new Set(
      listed.result.tools?.map((tool) => tool?.name).filter(Boolean) ?? [],
    );
    for (const name of [
      "list_memory_projects",
      "search_notes",
      "basic_memory_diagnostics",
    ]) {
      if (!names.has(name)) {
        throw new Error(
          `Basic Memory MCP does not expose required tool ${name}.`,
        );
      }
    }
    const projects = await mcpPost(
      fetcher,
      url,
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "list_memory_projects",
          arguments: { output_format: "json" },
        },
      },
      sessionId,
    );
    assertMcpProject(paths, projects.result);
    const search = await mcpPost(
      fetcher,
      url,
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "search_notes",
          arguments: {
            project: expected.name,
            query: "pythiareadinessnomatch",
            search_type: "text",
            output_format: "json",
            page: 1,
            page_size: 1,
          },
        },
      },
      sessionId,
    );
    assertTextSearch(search.result);
    const diagnostics = await mcpPost(
      fetcher,
      url,
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "basic_memory_diagnostics", arguments: {} },
      },
      sessionId,
    );
    assertMcpDiagnostics(paths, diagnostics.result);
  } finally {
    try {
      await fetcher(url, {
        method: "DELETE",
        headers: {
          accept: "application/json, text/event-stream",
          "mcp-session-id": sessionId,
          "mcp-protocol-version": PROTOCOL_VERSION,
        },
        signal: AbortSignal.timeout(2_000),
      });
    } catch {}
  }
  if (childExited(options.child)) {
    throw new Error("Basic Memory exited during readiness verification.");
  }
  return { project: expected.name, path: expected.path, search: "text" };
}
