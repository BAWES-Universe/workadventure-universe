import { describe, it, expect, vi } from "vitest";
import { LinearAdapter } from "../linear-sh/adapter";
const a = {
  subject: "a",
  accountId: "aa",
  linearUserId: "la",
  workspaceId: "w",
  teamIds: ["t"],
};
const row = (id: string) => ({
  id,
  identifier: `DEMO-${id}`,
  title: "Example",
  url: "https://linear.app/demo/issue/example",
  assigneeId: "la",
  teamId: "t",
  stateId: "s",
  status: "IN PROGRESS",
  updatedAt: "2026-01-01T00:00:00Z",
});
const wrap = (structuredContent: unknown) => ({
  structuredContent,
  content: [
    {
      type: "text",
      text: "untrusted incidental https://example.com/avatar.png",
    },
  ],
});
describe("Linear SH pagination", () => {
  it("resolves exact team workflow states across permitted teams and handles empty results", async () => {
    const call = vi.fn(async (tool, args) =>
      tool === "list_issue_statuses"
        ? wrap([
            {
              id: `progress-${args.team}`,
              teamId: args.team,
              name: "IN PROGRESS",
            },
            { id: `review-${args.team}`, teamId: args.team, name: "In Review" },
          ])
        : wrap({ issues: [], hasNextPage: false })
    );
    const result = await new LinearAdapter({ call }).list({
      ...a,
      teamIds: ["t2", "t"],
    });
    expect(result).toEqual({ issues: [], complete: true, absentTeams: [] });
    expect(
      call.mock.calls
        .filter(([tool]) => tool === "list_issues")
        .map(([, args]) => args)
    ).toEqual([
      { assignee: "la", team: "t", state: "progress-t", limit: 50 },
      { assignee: "la", team: "t2", state: "progress-t2", limit: 50 },
    ]);
  });
  it("keeps employee/status/team filters, deduplicates and renders without any LLM", async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce(
        wrap([{ id: "s", teamId: "t", name: "in progress" }])
      )
      .mockResolvedValueOnce(
        wrap({ issues: [row("2")], hasNextPage: true, nextCursor: "next" })
      )
      .mockResolvedValueOnce(
        wrap({ issues: [row("2"), row("1")], hasNextPage: false })
      );
    const out = await new LinearAdapter({ call }).list(a);
    expect(out.complete).toBe(true);
    expect(out.issues.map((i) => i.id)).toEqual(["1", "2"]);
    expect(call.mock.calls[2][1]).toEqual({
      assignee: "la",
      team: "t",
      state: "s",
      limit: 50,
      cursor: "next",
    });
    expect(call).toHaveBeenCalledTimes(3);
  });
  it.each([undefined, "again"])(
    "does not claim completeness with missing/repeated cursor %s",
    async (cursor) => {
      const call = vi
        .fn()
        .mockResolvedValueOnce(
          wrap([{ id: "s", teamId: "t", name: "In Progress" }])
        )
        .mockResolvedValue(
          wrap({ issues: [row("1")], hasNextPage: true, nextCursor: cursor })
        );
      const out = await new LinearAdapter({ call }).list(a);
      expect(out.complete).toBe(false);
      expect(call.mock.calls.length).toBeLessThanOrEqual(3);
    }
  );
  it("rejects wrong assignee, state ID, incomplete envelope and tool errors", async () => {
    for (const result of [
      wrap({
        issues: [{ ...row("1"), assigneeId: "other" }],
        hasNextPage: false,
      }),
      wrap({
        issues: [{ ...row("1"), stateId: "review" }],
        hasNextPage: false,
      }),
      wrap({ issues: [] }),
      { isError: true, structuredContent: { issues: [], hasNextPage: false } },
    ]) {
      const call = vi
        .fn()
        .mockResolvedValueOnce(
          wrap([{ id: "s", teamId: "t", name: "In Progress" }])
        )
        .mockResolvedValue(result);
      await expect(new LinearAdapter({ call }).list(a)).rejects.toThrow();
    }
  });
});
