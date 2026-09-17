import { describe, expect, it, vi } from "vitest";
import { LinearShMCP } from "../mcp/LinearShMCP";
import { digest } from "../linear-sh/policy";
const tools = [
  {
    name: "get_issue",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "save_issue",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, title: { type: "string" } },
    },
  },
];
const hash = digest(tools);
function fixture(
  result: unknown = {
    structuredContent: { id: "issue-1" },
    content: [{ type: "text", text: '{"id":"issue-1"}' }],
  }
) {
  const post = vi.fn(async (_url, body: any, _options?: unknown) => ({
    headers: {},
    data: {
      jsonrpc: "2.0",
      id: body.id,
      result:
        body.method === "tools/list"
          ? { tools }
          : body.method === "initialize"
          ? { protocolVersion: "2024-11-05" }
          : result,
    },
  }));
  const invalidated = vi.fn(async () => undefined);
  const mcp = new LinearShMCP(
    "selected-connection",
    "employee-a",
    "fictional-token",
    hash,
    undefined,
    { post } as any,
    invalidated
  );
  return { mcp, post, invalidated };
}
describe("Linear SH MCP extension", () => {
  it("retains a dispatched provider result after interaction cancellation without retry", async () => {
    const f = fixture();
    const controller = new AbortController();
    const mcp = new LinearShMCP("connection", "employee", "fixture", hash, controller.signal, { post: f.post } as any);
    await mcp.initialize();
    f.post.mockImplementationOnce(async (_url, body, options: any) => {
      expect(options.signal).toBeUndefined();
      controller.abort();
      return { headers: {}, data: { jsonrpc: "2.0", id: body.id, result: { structuredContent: { success: true, id: "issue-1" } } } };
    });
    expect(await mcp.call("save_issue", { id: "issue-1", title: "Fictional change" })).toMatchObject({ structuredContent: { success: true } });
    expect(f.post).toHaveBeenCalledTimes(4);
    await expect(mcp.call("save_issue", { id: "issue-1", title: "Fictional change" })).rejects.toThrow();
    expect(f.post).toHaveBeenCalledTimes(4);
  });
  it("retains complete arguments, call ID, selected connection, structured/text output and errors", async () => {
    const f = fixture();
    await f.mcp.initialize();
    const result = await f.mcp.call("get_issue", { id: "issue-1" });
    expect(result).toHaveProperty("structuredContent");
    expect(result).toHaveProperty("content");
    expect(f.mcp.ledger[0]).toMatchObject({
      connectionId: "selected-connection",
      subject: "employee-a",
      arguments: { id: "issue-1" },
      outcome: "ok",
      result,
    });
    expect(f.post.mock.calls[3][1].id).toBe(f.mcp.ledger[0].callId);
    const err = fixture({
      isError: true,
      content: [{ type: "text", text: "Provider failure" }],
    });
    await err.mcp.initialize();
    await expect(
      err.mcp.call("save_issue", { id: "issue-1", title: "X" })
    ).rejects.toThrow("unknown");
    expect(err.mcp.ledger[0].result?.isError).toBe(true);
  });
  it("requires pinned tools/list schema and never routes duplicate names or unknown fields", async () => {
    const f = fixture();
    await f.mcp.initialize();
    await expect(
      f.mcp.call("delete_issue", { id: "issue-1" })
    ).rejects.toThrow();
    await expect(
      f.mcp.call("save_issue", { id: "issue-1", assignee: "other" })
    ).rejects.toThrow();
    const bad = new LinearShMCP(
      "different-connection",
      "employee-a",
      "fictional",
      "0".repeat(64),
      undefined,
      {
        post: f.post,
      } as any
    );
    await expect(bad.initialize()).rejects.toThrow("schema");
    expect(f.mcp.ledger).toHaveLength(0);
  });
  it("does not replay mutations on network/401 failures and invalidates the token for a later request", async () => {
    for (const error of [
      new Error("connection reset"),
      { response: { status: 401 } },
    ]) {
      const f = fixture();
      await f.mcp.initialize();
      f.post.mockRejectedValueOnce(error);
      await expect(
        f.mcp.call("save_issue", { title: "Example" })
      ).rejects.toThrow("unknown");
      expect(f.post).toHaveBeenCalledTimes(4);
      expect(f.mcp.ledger[0].outcome).toBe("unknown");
      if ("response" in error) expect(f.invalidated).toHaveBeenCalledOnce();
    }
  });
  it("binds a complete SSE envelope to the actual JSON-RPC call ID", async () => {
    const f = fixture();
    await f.mcp.initialize();
    f.post.mockImplementationOnce(
      async (_url, body: any) =>
        ({
          headers: {},
          data: `event: message\ndata: ${JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: { structuredContent: { id: "issue-1" } },
          })}\n\n`,
        } as any)
    );
    expect(await f.mcp.call("get_issue", { id: "issue-1" })).toEqual({
      structuredContent: { id: "issue-1" },
    });
  });
});
