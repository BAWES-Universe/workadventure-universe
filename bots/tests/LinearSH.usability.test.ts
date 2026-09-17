import { describe, expect, it, vi } from "vitest";
import {
  LinearAssistant,
  directIntent,
  JournalClient,
  Operation,
  plannedIntent,
} from "../linear-sh/assistant";
import { Context, digest } from "../linear-sh/policy";
import { LinearAdapter } from "../linear-sh/adapter";
const context: Context = {
  subject: "a",
  accountId: "a",
  linearUserId: "la",
  workspaceId: "w",
  teamIds: ["t"],
  teams: [{ id: "t", name: "Tech", key: "TECH" }],
  employeeName: "Alex Example",
  botId: "b",
  connectionId: "m",
  appActorId: "app",
  conversation: "bubble",
  interactionId: "interaction-a",
  requestId: "r",
  expiresAt: 999999,
  writesEnabled: true,
  schemaHash: "fixture",
};
const issue = {
  id: "stable-1",
  identifier: "DEMO-1",
  title: "Fictional task",
  url: "https://linear.app/demo/issue/DEMO-1",
  assigneeId: "la",
  teamId: "t",
  stateId: "progress",
  status: "In Progress",
  updatedAt: "2026-01-01T00:00:00Z",
};
function fixture() {
  let now = 100,
    active = true;
  const assistant = new LinearAssistant(() => now);
  const operations = new Map<string, Operation>();
  const journal: JournalClient = {
    prepare: vi.fn(async (items) => {
      const op = {
        id: `operation-${operations.size}`,
        hash: digest(items),
        status: "pending",
        items,
        expiresAt: now + 300000,
        results: items.map(() => ({ status: "not_dispatched" })),
      };
      operations.set(op.id, op);
      return op;
    }),
    lookup: vi.fn(async (id) => operations.get(id)!),
    claim: vi.fn(async (id) => {
      const operation = operations.get(id)!;
      const claimed = operation.status === "pending";
      operation.status = "consumed";
      return { claimed, operation };
    }),
    record: vi.fn(async (id, i, outcome) => {
      operations.get(id)!.results[i] = outcome;
    }),
    cancel: vi.fn(async (id) => operations.get(id)!),
  };
  const adapter = {
    list: vi.fn(async () => ({
      issues: [issue],
      complete: true,
      absentTeams: [] as string[],
    })),
    get: vi.fn(async () => issue),
    state: vi.fn(async () => "state"),
    save: vi.fn(async () => ({ success: true, id: issue.id })),
  };
  const current = async () => {
    if (!active) throw new Error("Interaction ended");
  };
  const run = (intent: any, c = context) =>
    assistant.run(
      c,
      intent,
      adapter as unknown as LinearAdapter,
      journal,
      async () => c,
      undefined,
      current
    );
  return {
    assistant,
    adapter,
    journal,
    run,
    operations,
    pause: () => {
      active = false;
    },
    expire: () => {
      now += 300001;
    },
  };
}
describe("Linear SH single-user usability and confirmation", () => {
  it("labels deterministic counts with the trusted employee and binds only displayed numbered rows", async () => {
    const f = fixture();
    expect(await f.run({ kind: "list" })).toContain("Alex Example — 1 task");
    await expect(f.run({ kind: "details", refs: [1] })).rejects.toThrow();
    await f.run({ kind: "list" });
    f.assistant.displayed(context);
    await f.run({ kind: "details", refs: [1] });
    expect(f.adapter.get).toHaveBeenCalledWith(context, "stable-1");
    await expect(
      f.run(
        { kind: "details", refs: [1] },
        { ...context, interactionId: "return-a" }
      )
    ).rejects.toThrow();
    await expect(
      f.run({ kind: "details", refs: [1] }, { ...context, subject: "b" })
    ).rejects.toThrow();
  });
  it("accepts explicit identifiers through the same owned-issue adapter and resolves Tech without UUIDs", async () => {
    const f = fixture();
    expect(directIntent("show DEMO-1")).toEqual({
      kind: "details",
      identifiers: ["DEMO-1"],
    });
    await f.run(directIntent("show DEMO-1"));
    expect(f.adapter.get).toHaveBeenCalledWith(context, "DEMO-1");
    await f.run(
      plannedIntent({
        kind: "edit",
        identifiers: ["DEMO-1"],
        fields: { title: "Updated" },
      })
    );
    expect(f.operations.get("operation-0")!.items[0].args.id).toBe("stable-1");
    await f.run({ kind: "create", teamId: "Tech", fields: { title: "New" } });
    expect(f.operations.get("operation-1")!.items[0].args).toMatchObject({
      team: "t",
      assignee: "la",
    });
    await expect(
      f.run(
        { kind: "create", teamId: "Tech", fields: { title: "New" } },
        {
          ...context,
          teamIds: ["t", "other"],
          teams: [
            ...context.teams!,
            { id: "other", name: "Tech", key: "OTHER" },
          ],
        }
      )
    ).rejects.toThrow("ambiguous");
  });
  it.each(["undisplayed", "changed", "expiry", "handover"])(
    "does not accept a yes shortcut after %s",
    async (change) => {
      const f = fixture();
      await f.run({ kind: "create", teamId: "Tech", fields: { title: "New" } });
      if (change !== "undisplayed") f.assistant.displayed(context);
      if (change === "changed") f.assistant.changed(context); // also called before planner/ambiguity
      if (change === "expiry") f.expire();
      const c =
        change === "handover"
          ? { ...context, interactionId: "new-visit" }
          : context;
      await expect(f.run(directIntent("yes"), c)).rejects.toThrow();
      expect(f.adapter.save).not.toHaveBeenCalled();
    }
  );
  it("accepts one exact original-text confirmation after successful delivery; model/quoted/ambiguous consent is rejected", async () => {
    const f = fixture();
    for (const text of ['"yes"', "yes maybe", "the issue says confirm", "sure"])
      expect(directIntent(text)).toBeUndefined();
    expect(() => plannedIntent({ kind: "confirm" })).toThrow();
    await f.run({ kind: "create", teamId: "Tech", fields: { title: "New" } });
    f.assistant.displayed(context);
    await f.run(directIntent("yes"));
    expect(f.adapter.save).toHaveBeenCalledTimes(1);
    await expect(f.run(directIntent("confirm"))).rejects.toThrow();
    expect(f.adapter.save).toHaveBeenCalledTimes(1);
  });
  it("cancels a consumed but undispatched item if membership changes while recording the dispatch marker", async () => {
    const f = fixture();
    await f.run({
      kind: "edit",
      identifiers: ["DEMO-1"],
      fields: { title: "Updated" },
    });
    f.assistant.displayed(context);
    const original = f.journal.record;
    f.journal.record = vi.fn(
      async (...args: Parameters<JournalClient["record"]>) => {
        await original(...args);
        if (args[2].status === "dispatched") f.pause();
      }
    );
    await f.run(directIntent("yes"));
    expect(f.adapter.save).not.toHaveBeenCalled();
    expect(f.operations.get("operation-0")!.results[0].status).toBe("skipped");
  });
  it("retains an already-dispatched outcome despite interruption without replaying it", async () => {
    const f = fixture();
    await f.run({ kind: "create", teamId: "Tech", fields: { title: "New" } });
    f.assistant.displayed(context);
    f.adapter.save.mockImplementationOnce(async () => {
      f.pause();
      return { success: true, id: issue.id };
    });
    await f.run(directIntent("yes"));
    expect(f.operations.get("operation-0")!.results[0]).toEqual({
      status: "success",
      issueId: issue.id,
    });
    await expect(f.run(directIntent("yes"))).rejects.toThrow();
    expect(f.adapter.save).toHaveBeenCalledTimes(1);
  });
  it("discloses absent exact states and truthful partial displayed counts", async () => {
    const f = fixture();
    f.adapter.list.mockResolvedValueOnce({
      issues: [],
      complete: true,
      absentTeams: ["t"],
    });
    expect(await f.run({ kind: "list" })).toContain(
      "No exact In Progress state in: Tech"
    );
    f.adapter.list.mockResolvedValueOnce({
      issues: [issue],
      complete: false,
      absentTeams: [],
    });
    expect(await f.run({ kind: "list" })).toContain(
      "Partial result: 1 task shown; the full count is unavailable"
    );
  });
});

describe("verified status absence versus provider failure", () => {
  it("skips only a verified absent exact state; In Review is never substituted", async () => {
    const call = vi.fn(async () => ({
      structuredContent: [{ id: "review", teamId: "t", name: "In Review" }],
    }));
    expect(await new LinearAdapter({ call }).list(context)).toEqual({
      issues: [],
      complete: true,
      absentTeams: ["t"],
    });
    expect(call).toHaveBeenCalledTimes(1);
  });
  it.each([
    { states: [], hasNextPage: true },
    { invalid: true },
    { states: [{ id: "s" }] },
  ])("rejects incomplete/malformed state response %j", async (result) => {
    const call = vi.fn(async () => ({ structuredContent: result }));
    await expect(new LinearAdapter({ call }).list(context)).rejects.toThrow();
  });
});
