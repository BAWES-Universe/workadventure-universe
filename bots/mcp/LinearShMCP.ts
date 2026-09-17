import axios from "axios";
import { randomUUID } from "node:crypto";
import { digest, requireValue } from "../linear-sh/policy";

export interface Envelope {
  content?: unknown[];
  structuredContent?: unknown;
  isError?: boolean;
  [key: string]: unknown;
}
export interface LedgerEntry {
  callId: string;
  connectionId: string;
  subject: string;
  tool: string;
  arguments: Record<string, unknown>;
  result?: Envelope;
  outcome: "ok" | "error" | "unknown";
}
export interface ToolSchema {
  name: string;
  inputSchema: Record<string, unknown>;
}
export const LINEAR_MCP_URL = "https://mcp.linear.app/mcp";

/** Scoped extension of the bot MCP integration. No generic retry/media/telemetry path. */
export class LinearShMCP {
  readonly ledger: LedgerEntry[] = [];
  private session?: string;
  private schemas: ToolSchema[] = [];
  constructor(
    readonly connectionId: string,
    readonly subject: string,
    private token: string,
    private expectedSchemaHash: string,
    private signal?: AbortSignal,
    private http = axios,
    private onUnauthorized?: () => Promise<unknown>
  ) {}

  async initialize(): Promise<void> {
    const init = await this.rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "universe-linear-sh", version: "1.0" },
    });
    requireValue(init && !init.error, "MCP initialization failed");
    await this.http.post(
      LINEAR_MCP_URL,
      { jsonrpc: "2.0", method: "notifications/initialized" },
      this.options()
    );
    const tools: ToolSchema[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let n = 0; n < 10; n++) {
      const reply = await this.rpc("tools/list", cursor ? { cursor } : {});
      requireValue(!reply.error && Array.isArray(reply.result?.tools));
      tools.push(...reply.result.tools);
      cursor = reply.result.nextCursor;
      if (!cursor) break;
      requireValue(
        typeof cursor === "string" && !seen.has(cursor) && n < 9,
        "Incomplete tool schemas"
      );
      seen.add(cursor);
    }
    requireValue(
      new Set(tools.map((t) => t.name)).size === tools.length,
      "Duplicate tools"
    );
    requireValue(
      digest(
        tools
          .map((t) => ({ name: t.name, inputSchema: t.inputSchema }))
          .sort((a, b) => a.name.localeCompare(b.name))
      ) === this.expectedSchemaHash,
      "Unverified MCP schema"
    );
    this.schemas = tools;
  }
  async call(tool: string, args: Record<string, unknown>): Promise<Envelope> {
    requireValue(
      [
        "list_issues",
        "get_issue",
        "list_issue_statuses",
        "save_issue",
      ].includes(tool),
      "Tool not permitted"
    );
    const schema = this.schemas.find((s) => s.name === tool)?.inputSchema as
      | { properties?: Record<string, unknown>; required?: string[] }
      | undefined;
    requireValue(
      schema?.properties &&
        Object.keys(args).every((k) =>
          Object.prototype.hasOwnProperty.call(schema.properties!, k)
        ) &&
        (schema.required || []).every((k) => k in args),
      "Unsupported tool arguments"
    );
    requireValue(
      this.ledger.length < 60 && !this.signal?.aborted,
      "Request stopped"
    );
    const entry: LedgerEntry = {
      callId: randomUUID(),
      connectionId: this.connectionId,
      subject: this.subject,
      tool,
      arguments: structuredClone(args),
      outcome: "unknown",
    };
    this.ledger.push(entry);
    try {
      const response = await this.rpc(
        "tools/call",
        { name: tool, arguments: args },
        entry.callId,
        tool === "save_issue"
      );
      // Keep both structured content and text, errors and pagination; never flatten to content alone.
      const result: Envelope = response.result ?? {
        isError: true,
        rpcError: response.error,
      };
      entry.result = result;
      entry.outcome = response.error || result.isError ? "error" : "ok";
      requireValue(entry.outcome === "ok", "Linear tool reported an error");
      return result;
    } catch {
      // No retries. A write which crossed this boundary is never assumed not to have happened.
      throw new Error(
        tool === "save_issue"
          ? "Mutation outcome unknown; reconciliation required"
          : "Linear read unavailable"
      );
    }
  }
  private options() {
    return {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        "MCP-Protocol-Version": "2024-11-05",
        ...(this.session ? { "Mcp-Session-Id": this.session } : {}),
      },
      timeout: 20000,
      maxRedirects: 0,
      maxContentLength: 2_000_000,
      signal: this.signal,
    };
  }
  private async rpc(
    method: string,
    params: unknown,
    id: string = randomUUID(),
    mutation = false
  ): Promise<any> {
    requireValue(!this.signal?.aborted, "Request stopped");
    let response;
    try {
      response = await this.http.post(
        LINEAR_MCP_URL,
        { jsonrpc: "2.0", id, method, params },
        // Preserve an already-sent mutation outcome after interruption; timeout remains bounded, no retries.
        { ...this.options(), ...(mutation ? { signal: undefined } : {}) }
      );
    } catch (error: any) {
      if (error?.response?.status === 401) await this.onUnauthorized?.();
      throw new Error("MCP transport unavailable");
    }
    if (response.headers["mcp-session-id"])
      this.session = String(response.headers["mcp-session-id"]);
    let body = response.data;
    if (typeof body === "string") {
      const events = body.split(/\r?\n\r?\n/).flatMap((event: string) => {
        const data = event
          .split(/\r?\n/)
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trimStart())
          .join("\n");
        if (!data) return [];
        try {
          return [JSON.parse(data)];
        } catch {
          return [];
        }
      });
      body = events.find((v: any) => v.id === id);
    }
    requireValue(
      body?.jsonrpc === "2.0" && body.id === id,
      "Invalid MCP response"
    );
    return body;
  }
}
