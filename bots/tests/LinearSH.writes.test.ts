import { describe, expect, it, vi } from "vitest";
import {
  LinearAssistant,
  JournalClient,
  Operation,
  directIntent,
  plannedIntent,
} from "../linear-sh/assistant";
import { Context, digest } from "../linear-sh/policy";
import { LinearAdapter } from "../linear-sh/adapter";
const c: Context = {
  subject: "a",
  accountId: "aa",
  linearUserId: "la",
  workspaceId: "w",
  teamIds: ["t"],
  botId: "b",
  connectionId: "mcp",
  appActorId: "app",
  conversation: "bubble",
  interactionId: "interaction-a",
  requestId: "r",
  expiresAt: 99999,
  writesEnabled: true,
  schemaHash: "fixture",
};
const row = (id: string, assigneeId = "la") => ({
  id,
  identifier: `DEMO-${id}`,
  title: "Example",
  url: "https://linear.app/demo/issue/example",
  assigneeId,
  teamId: "t",
  stateId: "s",
  status: "In Progress",
  updatedAt: "2026-01-01T00:00:00Z",
});

function fixture() {
  const records = new Map<string, Operation>();
  let count = 0;
  const journal: JournalClient = {
    prepare: vi.fn(async (items) => {
      const op = {
        id: `op-${++count}`,
        hash: digest(items),
        status: "pending",
        items: structuredClone(items),
        results: items.map(() => ({ status: "not_dispatched" })),
        expiresAt: 9999,
      };
      records.set(op.id, op);
      return structuredClone(op);
    }),
    lookup: vi.fn(async (id) => structuredClone(records.get(id)!)),
    claim: vi.fn(async (id) => {
      const op = records.get(id)!;
      const claimed = op.status === "pending";
      if (claimed) op.status = "consumed";
      return { claimed, operation: structuredClone(op) };
    }),
    record: vi.fn(async (id, index, outcome) => {
      records.get(id)!.results[index] = outcome;
    }),
    cancel: vi.fn(async (id) => {
      const op = records.get(id)!;
      if (op.status === "pending") op.status = "cancelled";
      return structuredClone(op);
    }),
  };
  const adapter = {
    list: vi.fn(async () => ({ issues: [row("1"), row("2")], complete: true })),
    get: vi.fn(async (_actor, id) => row(id)),
    state: vi.fn(async () => "done"),
    save: vi.fn(async (args) => ({ success: true, id: args.id ?? "new" })),
  };
  const assistant = new LinearAssistant(() => 100);
  const run = async (
    intent: any,
    context = c,
    instance = assistant,
    signal?: AbortSignal
  ) => {
    const result = await instance.run(
      context,
      intent,
      adapter as unknown as LinearAdapter,
      journal,
      async () => context,
      signal
    );
    instance.displayed(context); // Simulate the authoritative socket-queue receipt.
    return result;
  };
  return { records, journal, adapter, assistant, run };
}
describe("Linear SH confirmed writes", () => {
  it("never interprets model confirmations; defaults today to exact In Progress", () => {
    expect(directIntent("my tasks today")).toEqual({ kind: "list" });
    expect(() => plannedIntent({ kind: "confirm", id: "fake" })).toThrow();
    expect(() =>
      plannedIntent({ kind: "edit", refs: [1], fields: { assignee: "other" } })
    ).toThrow();
  });
  it("previews exact first-two IDs and fields, then confirms once even concurrently or after restart", async () => {
    const f = fixture();
    await f.run({ kind: "list" });
    const preview = await f.run({
      kind: "edit",
      refs: [1, 2],
      fields: { status: "Done" },
    });
    expect(preview).toContain("Confirm op-1");
    expect(f.adapter.save).not.toHaveBeenCalled();
    expect(f.records.get("op-1")!.items.map((i) => i.args.id)).toEqual([
      "1",
      "2",
    ]);
    await Promise.all([
      f.run({ kind: "confirm", id: "op-1" }),
      f.run({ kind: "confirm", id: "op-1" }),
    ]);
    expect(f.adapter.save).toHaveBeenCalledTimes(2);
    await f.run(
      { kind: "confirm", id: "op-1" },
      c,
      new LinearAssistant(() => 100)
    );
    expect(f.adapter.save).toHaveBeenCalledTimes(2);
  });
  it("does not replay a timeout or continue an uncertain batch; reports per-item outcomes", async () => {
    const f = fixture();
    await f.run({ kind: "list" });
    await f.run({ kind: "edit", refs: [1, 2], fields: { title: "Changed" } });
    f.adapter.save.mockRejectedValueOnce(
      new Error("socket lost after dispatch")
    );
    const result = await f.run({ kind: "confirm", id: "op-1" });
    expect(result).toContain("Outcome unknown");
    expect(result).toContain("Not executed");
    await f.run({ kind: "confirm", id: "op-1" });
    expect(f.adapter.save).toHaveBeenCalledTimes(1);
  });
  it("reports partial batch success and does not repeat successful items", async () => {
    const f = fixture();
    await f.run({ kind: "list" });
    await f.run({ kind: "edit", refs: [1, 2], fields: { priority: 2 } });
    f.adapter.save
      .mockResolvedValueOnce({ success: true, id: "1" })
      .mockRejectedValueOnce(new Error("timeout"));
    expect(await f.run({ kind: "confirm", id: "op-1" })).toMatch(
      /1\. Saved.*\n2\. Outcome unknown/
    );
    await f.run({ kind: "confirm", id: "op-1" });
    expect(f.adapter.save).toHaveBeenCalledTimes(2);
  });
  it("checks updated issue and access again before mutation, and consumes rejected attempts", async () => {
    const f = fixture();
    await f.run({ kind: "list" });
    await f.run({ kind: "edit", refs: [1], fields: { priority: 1 } });
    f.adapter.get.mockResolvedValueOnce({
      ...row("1"),
      updatedAt: "2026-01-02T00:00:00Z",
    });
    expect(await f.run({ kind: "confirm", id: "op-1" })).toContain(
      "Not executed"
    );
    await f.run({ kind: "confirm", id: "op-1" });
    expect(f.adapter.save).not.toHaveBeenCalled();
  });
  it("binds snapshots across A -> B -> A, refuses ambiguous/newer lists and cross-user references", async () => {
    const f = fixture();
    await f.run({ kind: "list" });
    await expect(
      f.run(
        { kind: "edit", refs: [1], fields: { title: "X" } },
        { ...c, subject: "b", linearUserId: "lb" }
      )
    ).rejects.toThrow();
    await f.run({ kind: "edit", refs: [1], fields: { title: "X" } });
    await f.run({ kind: "list" });
    await expect(
      f.run({ kind: "edit", refs: [1], fields: { title: "X" } })
    ).rejects.toThrow("list code");
  });
  it("create is self-assigned, requires a permitted team, and cannot bypass write disable", async () => {
    const f = fixture();
    await f.run({ kind: "create", teamId: "t", fields: { title: "New task" } });
    expect(f.records.get("op-1")!.items[0].args).toEqual({
      title: "New task",
      team: "t",
      assignee: "la",
    });
    await expect(
      f.run({ kind: "create", teamId: "other", fields: { title: "Bad" } })
    ).rejects.toThrow();
    await expect(
      f.run({ kind: "confirm", id: "op-1" }, { ...c, writesEnabled: false })
    ).rejects.toThrow("disabled");
    expect(f.adapter.save).not.toHaveBeenCalled();
  });
  it("cancellation and changed confirmation content cannot mutate", async () => {
    const f = fixture();
    await f.run({ kind: "create", teamId: "t", fields: { title: "New task" } });
    await f.run({ kind: "cancel", id: "op-1" });
    await f.run({ kind: "confirm", id: "op-1" });
    f.records.get("op-1")!.items[0].args.title = "tampered";
    await expect(f.run({ kind: "confirm", id: "op-1" })).rejects.toThrow(
      "changed"
    );
    expect(f.adapter.save).not.toHaveBeenCalled();
  });
  it("binds references only to the bounded displayed rows and marks omitted rows as partial", async () => {
    const f = fixture();
    f.adapter.list.mockResolvedValueOnce({
      issues: Array.from({ length: 101 }, (_, n) => row(String(n + 1))),
      complete: true,
    });
    const response = await f.run({ kind: "list" });
    expect(response).toContain("Partial result: 100 tasks shown");
    expect(response.length).toBeLessThan(24000);
    await expect(f.run({ kind: "details", refs: [101] })).rejects.toThrow(
      "Reference"
    );
  });
  it("honors cancellation during the pre-write ownership read without dispatching or replaying", async () => {
    const f = fixture();
    await f.run({ kind: "list" });
    await f.run({ kind: "edit", refs: [1], fields: { title: "Changed" } });
    const controller = new AbortController();
    f.adapter.get.mockImplementationOnce(async (_actor, id) => {
      controller.abort();
      return row(id);
    });
    expect(
      await f.run(
        { kind: "confirm", id: "op-1" },
        c,
        f.assistant,
        controller.signal
      )
    ).toContain("Not executed");
    await f.run({ kind: "confirm", id: "op-1" });
    expect(f.adapter.save).not.toHaveBeenCalled();
  });
});
