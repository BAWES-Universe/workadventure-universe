import { describe, expect, it } from "vitest";
import {
  validateFields,
  validateIssue,
  renderIssues,
  selectReferences,
} from "../linear-sh/policy";

const actor = {
  subject: "subject-a",
  accountId: "account-a",
  linearUserId: "linear-a",
  workspaceId: "workspace",
  teamIds: ["team-a"],
};
const issue = {
  id: "issue-a",
  identifier: "DEMO-1",
  title: "Fictional task",
  url: "https://linear.app/demo/issue/DEMO-1",
  assigneeId: "linear-a",
  teamId: "team-a",
  stateId: "state-a",
  status: "In Progress",
  updatedAt: "2026-01-01T00:00:00Z",
};

describe("Linear SH read policy", () => {
  it("checks returned ownership, team and exact state, regardless of creator or due date", () => {
    expect(
      validateIssue(
        { ...issue, creatorId: "someone-else", dueDate: "2020-01-01" },
        actor,
        "in progress"
      )
    ).toMatchObject({ id: "issue-a" });
    for (const change of [
      { assigneeId: "linear-b" },
      { teamId: "other" },
      { status: "In Review" },
      { status: "Done" },
      { status: "Todo" },
      { status: "Backlog" },
    ]) {
      expect(() =>
        validateIssue({ ...issue, ...change }, actor, "In Progress")
      ).toThrow();
    }
  });
  it("renders deterministic links/counts, and distinguishes partial pages", () => {
    expect(renderIssues([issue], true)).toBe(
      "1 task\n1. [DEMO-1](https://linear.app/demo/issue/DEMO-1) Fictional task"
    );
    expect(renderIssues([issue], false)).toContain(
      "Partial result: 1 task shown"
    );
    expect(renderIssues([], true)).toBe("0 tasks — no matching tasks.");
  });
  it("keeps numbered references bound to the original employee and list", () => {
    const snapshot = {
      subject: "subject-a",
      conversation: "bubble",
      expiresAt: 100,
      issues: [issue],
    };
    expect(
      selectReferences(snapshot, actor.subject, "bubble", [1], 50)[0].id
    ).toBe("issue-a");
    for (const args of [
      ["subject-b", "bubble", 50],
      ["subject-a", "other", 50],
      ["subject-a", "bubble", 101],
    ] as const) {
      expect(() =>
        selectReferences(snapshot, args[0], args[1], [1], args[2])
      ).toThrow();
    }
    expect(() =>
      selectReferences(snapshot, actor.subject, "bubble", [0], 50)
    ).toThrow();
  });
  it("rejects hidden upsert, assignment, relation and administrative fields", () => {
    for (const key of [
      "id",
      "assignee",
      "assigneeId",
      "team",
      "teamId",
      "labels",
      "parentId",
      "delete",
      "__proto__",
    ]) {
      expect(() => validateFields(JSON.parse(`{"${key}":"x"}`))).toThrow();
    }
    expect(
      validateFields({
        title: "A task",
        priority: 2,
        dueDate: "2026-12-31",
        status: "Done",
      })
    ).toEqual({
      title: "A task",
      priority: 2,
      dueDate: "2026-12-31",
      status: "Done",
    });
    expect(() => validateFields({ dueDate: "2026-02-31" })).toThrow();
  });
});
