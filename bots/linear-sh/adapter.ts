import { Envelope } from "../mcp/LinearShMCP";
import {
  Actor,
  Issue,
  normalized,
  plain,
  requireValue,
  validateIssue,
} from "./policy";

export interface Caller {
  call(tool: string, args: Record<string, unknown>): Promise<Envelope>;
}
/** Fixture contract v1. Live tools/list AND result-shape acceptance remain mandatory. */
export function data(result: Envelope): any {
  requireValue(result.isError !== true, "Tool error");
  if (result.structuredContent !== undefined) return result.structuredContent;
  const texts = result.content?.filter((c: any) => c.type === "text") as
    | { text: string }[]
    | undefined;
  requireValue(texts?.length === 1, "Unsupported result envelope");
  return JSON.parse(texts[0].text);
}
export class LinearAdapter {
  constructor(private transport: Caller) {}
  async state(
    teamId: string,
    name: string,
    allowAbsent?: false
  ): Promise<string>;
  async state(
    teamId: string,
    name: string,
    allowAbsent: true
  ): Promise<string | undefined>;
  async state(
    teamId: string,
    name: string,
    allowAbsent = false
  ): Promise<string | undefined> {
    const result = data(
      await this.transport.call("list_issue_statuses", { team: teamId })
    );
    const states = Array.isArray(result) ? result : result.states;
    requireValue(
      Array.isArray(states) &&
        (Array.isArray(result) || result.hasNextPage === false),
      "Incomplete workflow states"
    );
    requireValue(
      states.every(
        (s) =>
          plain(s) &&
          s.teamId === teamId &&
          typeof s.id === "string" &&
          !!s.id &&
          typeof s.name === "string"
      ),
      "Unverified workflow states"
    );
    const matches = states.filter(
      (s) =>
        s.teamId === teamId &&
        typeof s.name === "string" &&
        normalized(s.name) === normalized(name)
    );
    if (!matches.length && allowAbsent) return undefined;
    requireValue(
      matches.length === 1 && typeof matches[0].id === "string",
      "Status unavailable or ambiguous"
    );
    return matches[0].id;
  }
  async list(
    actor: Actor,
    status = "In Progress"
  ): Promise<{ issues: Issue[]; complete: boolean; absentTeams: string[] }> {
    const found = new Map<string, Issue>();
    const absentTeams: string[] = [];
    let pages = 0;
    for (const teamId of [...actor.teamIds].sort()) {
      const stateId = await this.state(teamId, status, true);
      if (!stateId) {
        absentTeams.push(teamId);
        continue;
      }
      const seen = new Set<string>();
      let cursor: string | undefined;
      do {
        if (++pages > 20)
          return { issues: this.sorted(found), complete: false, absentTeams };
        const args = {
          assignee: actor.linearUserId,
          team: teamId,
          state: stateId,
          limit: 50,
          ...(cursor ? { cursor } : {}),
        };
        const result = data(await this.transport.call("list_issues", args));
        requireValue(
          plain(result) &&
            Array.isArray(result.issues) &&
            typeof result.hasNextPage === "boolean",
          "Unverified pagination"
        );
        for (const row of result.issues) {
          const issue = validateIssue(row, actor, status);
          requireValue(
            issue.teamId === teamId && issue.stateId === stateId,
            "Result scope mismatch"
          );
          const prior = found.get(issue.id);
          requireValue(
            !prior || JSON.stringify(prior) === JSON.stringify(issue),
            "Inconsistent repeated issue"
          );
          found.set(issue.id, issue);
        }
        if (!result.hasNextPage) break;
        const next = result.nextCursor;
        if (typeof next !== "string" || !next || seen.has(next))
          return { issues: this.sorted(found), complete: false, absentTeams };
        seen.add(next);
        cursor = next;
      } while (true);
    }
    return { issues: this.sorted(found), complete: true, absentTeams };
  }
  private sorted(issues: Map<string, Issue>) {
    return [...issues.values()].sort(
      (a, b) =>
        a.identifier.localeCompare(b.identifier, "en") ||
        a.id.localeCompare(b.id, "en")
    );
  }
  async get(actor: Actor, id: string): Promise<Issue> {
    const result = data(await this.transport.call("get_issue", { id }));
    const issue = validateIssue(result.issue ?? result, actor);
    requireValue(
      issue.id === id || issue.identifier === id,
      "Issue identity mismatch"
    );
    return issue;
  }
  async save(args: Record<string, unknown>): Promise<unknown> {
    return data(await this.transport.call("save_issue", args));
  }
}
