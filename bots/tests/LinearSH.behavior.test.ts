import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ initialize: vi.fn(), call: vi.fn() }));
vi.mock("../mcp/LinearShMCP", () => ({
  LinearShMCP: class {
    constructor(private connection: string, private subject: string) {}
    initialize() {
      return mocks.initialize(this.subject);
    }
    call(name: string, args: unknown) {
      return mocks.call(this.subject, name, args);
    }
  },
}));
import { LinearSHBehavior } from "../linear-sh/LinearSHBehavior";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
describe("Linear SH bounded behavior", () => {
  function fixture() {
    vi.stubEnv("LINEAR_SH_BOT_ID", "bot");
    vi.stubEnv("LINEAR_SH_ENABLED", "true");
    mocks.initialize.mockResolvedValue(undefined);
    mocks.call.mockImplementation(async (subject, name) =>
      name === "list_issue_statuses"
        ? {
            structuredContent: [
              { id: "progress", teamId: "team", name: "In Progress" },
            ],
          }
        : {
            structuredContent: {
              issues: [
                {
                  id: `${subject}-1`,
                  identifier: `DEMO-${subject}`,
                  title: `Fictional ${subject}`,
                  url: "https://linear.app/demo/issue/example",
                  assigneeId: subject,
                  teamId: "team",
                  stateId: "progress",
                  status: "In Progress",
                  updatedAt: "2026-01-01T00:00:00Z",
                },
              ],
              hasNextPage: false,
            },
          }
    );
    const api = vi.fn(async (body) =>
      body.action === "resolve"
        ? {
            context: {
              botId: "bot",
              subject: body.senderId,
              accountId: body.senderId,
              linearUserId: body.senderId,
              teamIds: ["team"],
              conversation: "world.bubble",
              interactionId: `interaction-${body.senderId}`,
              workspaceId: "workspace",
              connectionId: "connection",
              appActorId: "app",
              schemaHash: "fixture",
              requestId: "fixture",
              writesEnabled: false,
              expiresAt: Date.now() + 120000,
            },
            token: "fixture",
          }
        : { reply: "encrypted-fixture" }
    );
    const plan = vi.fn(),
      send = vi.fn();
    const check = vi.fn().mockResolvedValue(true);
    const behavior = new LinearSHBehavior({} as never);
    Object.assign(behavior, {
      adminApiService: { linearSh: api },
      aiService: { planLinearSh: plan },
      bot: {
        getFullConfig: () => ({
          botId: "bot",
          aiProviderRef: "existing-deepseek",
        }),
        checkLinearShInteraction: check,
        sendLinearShReply: send,
      },
    });
    const run = (subject: string, message = "my tasks today") =>
      behavior.onLinearShRequest("bubble", subject, message, "server-proof");
    return { behavior, api, plan, send, run, check };
  }
  it("uses exactly two issue tools per one-team list, zero LLM calls, and no repetition/media path", async () => {
    const f = fixture();
    await f.run("a");
    await f.run("a");
    expect(f.plan).not.toHaveBeenCalled();
    expect(mocks.call).toHaveBeenCalledTimes(4);
    expect(f.send).toHaveBeenCalledTimes(2);
    const replies = f.api.mock.calls
      .filter(([b]) => b.action === "seal")
      .map(([b]) => b.text.split("\nList code:")[0]);
    expect(replies[0]).toBe(replies[1]);
    expect(replies[0]).toContain("1 task");
    expect(f.send).toHaveBeenCalledWith("bubble", "encrypted-fixture");
  });
  it("isolates overlapping A/B/A requests and silently denies missing activation", async () => {
    const f = fixture();
    let release!: () => void;
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    mocks.initialize.mockImplementation((subject) =>
      subject === "a" ? paused : Promise.resolve()
    );
    const first = f.run("a");
    await vi.waitFor(() => expect(mocks.initialize).toHaveBeenCalledTimes(1));
    await f.run("b");
    release();
    await first;
    await f.run("a");
    expect(mocks.initialize).toHaveBeenCalledTimes(3);
    expect(
      mocks.call.mock.calls.filter(([subject]) => subject === "a")
    ).toHaveLength(2);
    expect(
      mocks.call.mock.calls.filter(([subject]) => subject === "b")
    ).toHaveLength(2);
    vi.stubEnv("LINEAR_SH_ENABLED", "false");
    const count = f.api.mock.calls.length;
    await f.run("a");
    expect(f.api).toHaveBeenCalledTimes(count);
  });
  it.each(["lookup", "planning", "seal"])(
    "drops interrupted responses during %s and does not replay when the interaction resumes",
    async (stage) => {
      const f = fixture();
      if (stage === "lookup") {
        const call = mocks.call.getMockImplementation()!;
        mocks.call.mockImplementation(async (...args) => {
          f.check.mockResolvedValue(false);
          return call(...args);
        });
      }
      if (stage === "planning")
        f.plan.mockImplementation(async () => {
          f.check.mockResolvedValue(false);
          return { kind: "list" };
        });
      if (stage === "seal") {
        const api = f.api.getMockImplementation()!;
        f.api.mockImplementation(async (body) => {
          if (body.action === "seal") f.check.mockResolvedValue(false);
          return api(body);
        });
      }
      await f.run(
        "a",
        stage === "planning" ? "please find my tasks" : "my tasks"
      );
      expect(f.send).not.toHaveBeenCalled();
      f.check.mockResolvedValue(true);
      await Promise.resolve();
      expect(f.send).not.toHaveBeenCalled();
    }
  );
  it("does not activate a list when final delivery has no receipt", async () => {
    const f = fixture();
    f.check.mockImplementation(
      async (_space, _interaction, receipt) => !receipt
    );
    await f.run("a");
    f.check.mockResolvedValue(true);
    f.plan.mockResolvedValue({ kind: "details", refs: [1] });
    mocks.call.mockClear();
    await f.run("a", "show the first task");
    expect(mocks.call).not.toHaveBeenCalled();
    const seals = f.api.mock.calls.filter(([body]) => body.action === "seal");
    expect(seals.at(-1)![0].text).toContain("fresh list");
  });
});
