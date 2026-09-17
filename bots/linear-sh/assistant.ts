import { randomUUID } from "node:crypto";
import { LinearAdapter } from "./adapter";
import {
  Context,
  Fields,
  Snapshot,
  digest,
  escapeText,
  plain,
  renderIssues,
  requireValue,
  selectReferences,
  validateFields,
} from "./policy";

export type Intent =
  | { kind: "list"; status?: string }
  | { kind: "details"; refs?: number[]; identifiers?: string[]; list?: string }
  | {
      kind: "edit";
      refs?: number[];
      identifiers?: string[];
      list?: string;
      fields: Fields;
    }
  | { kind: "create"; teamId: string; fields: Fields }
  | { kind: "confirm"; id?: string }
  | { kind: "cancel"; id: string };
export type Item =
  | { kind: "create"; args: Record<string, unknown>; stateName?: string }
  | {
      kind: "edit";
      teamId: string;
      expectedUpdatedAt: string;
      args: Record<string, unknown>;
      stateName?: string;
    };
export interface Operation {
  id: string;
  hash: string;
  status: string;
  items: Item[];
  results: { status: string; issueId?: string }[];
  expiresAt: number;
}
export interface JournalClient {
  prepare(items: Item[]): Promise<Operation>;
  lookup(id: string): Promise<Operation>;
  claim(
    id: string,
    hash: string
  ): Promise<{ claimed: boolean; operation: Operation }>;
  record(
    id: string,
    index: number,
    outcome: { status: string; issueId?: string }
  ): Promise<unknown>;
  cancel(id: string): Promise<Operation>;
}

/** Confirmation is parsed ONLY from the employee's original text, never from an LLM. */
export function directIntent(text: string): Intent | undefined {
  const input = text.trim();
  if (
    /^(?:(?:show|list|what are)\s+)?my\s+(?:tasks|issues)(?:\s+today)?[?.!]?$/i.test(
      input
    )
  )
    return { kind: "list" };
  if (/^(yes|confirm)$/i.test(input)) return { kind: "confirm" };
  const details =
    /^(?:show|details(?: of)?|open)\s+([a-z][a-z0-9]*-\d+)$/i.exec(input);
  if (details)
    return { kind: "details", identifiers: [details[1].toUpperCase()] };
  const confirm = /^(confirm|cancel) ([0-9a-f-]{36})$/i.exec(input);
  if (confirm)
    return {
      kind: confirm[1].toLowerCase() as "confirm" | "cancel",
      id: confirm[2],
    };
  return undefined;
}
export function plannedIntent(value: unknown): Intent {
  requireValue(
    plain(value) && typeof value.kind === "string",
    "Please specify a task action"
  );
  const keys: Record<string, string[]> = {
    list: ["kind", "status"],
    details: ["kind", "refs", "identifiers", "list"],
    edit: ["kind", "refs", "identifiers", "fields", "list"],
    create: ["kind", "teamId", "fields"],
  };
  const kind = value.kind;
  requireValue(
    keys[kind] && Object.keys(value).every((k) => keys[kind].includes(k)),
    "Unsupported action"
  );
  if (value.kind === "list")
    requireValue(
      value.status === undefined ||
        (typeof value.status === "string" &&
          value.status.length > 0 &&
          value.status.length < 100)
    );
  if (value.kind === "create")
    requireValue(
      typeof value.teamId === "string" && value.teamId.length > 0,
      "Specify a team name or key"
    );
  if (value.kind === "edit" || value.kind === "details")
    requireValue(
      (Array.isArray(value.refs) &&
        value.identifiers === undefined &&
        value.refs.length > 0 &&
        value.refs.length <= 10 &&
        value.refs.every((n) => Number.isInteger(n) && n > 0)) ||
        (value.refs === undefined &&
          Array.isArray(value.identifiers) &&
          value.identifiers.length > 0 &&
          value.identifiers.length <= 10 &&
          value.identifiers.every(
            (id) =>
              typeof id === "string" &&
              /^(?:[A-Z][A-Z0-9]*-\d+|[0-9a-f-]{36})$/i.test(id)
          ))
    );
  if ("list" in value) requireValue(typeof value.list === "string");
  if ("fields" in value)
    value = { ...value, fields: validateFields(value.fields) };
  return structuredClone(value) as Intent;
}

export class LinearAssistant {
  private snapshots = new Map<string, Map<string, Snapshot>>();
  private pending = new Map<string, () => void>();
  private confirmations = new Map<string, { id: string; expiresAt: number }>();
  constructor(private now = Date.now) {}
  clear(): void {
    this.snapshots.clear();
    this.pending.clear();
    this.confirmations.clear();
  }
  discard(c: Context): void {
    this.snapshots.delete(this.key(c));
    this.changed(c);
  }
  changed(c: Context): void {
    this.confirmations.delete(this.key(c));
    this.pending.delete(this.key(c));
  }
  displayed(c: Context): void {
    this.pending.get(this.key(c))?.();
    this.pending.delete(this.key(c));
  }
  private key(c: Context) {
    return digest({
      bot: c.botId,
      subject: c.subject,
      account: c.accountId,
      employee: c.linearUserId,
      workspace: c.workspaceId,
      connection: c.connectionId,
      conversation: c.conversation,
      interactionId: c.interactionId,
    });
  }
  private async references(
    c: Context,
    intent: { refs?: number[]; identifiers?: string[]; list?: string },
    adapter: LinearAdapter
  ) {
    if (intent.identifiers) {
      requireValue(
        new Set(intent.identifiers).size === intent.identifiers.length
      );
      return Promise.all(intent.identifiers.map((id) => adapter.get(c, id)));
    }
    const snapshots = this.snapshots.get(this.key(c));
    if (snapshots)
      for (const [id, s] of snapshots)
        if (s.expiresAt <= this.now()) snapshots.delete(id);
    requireValue(
      snapshots?.size && (intent.list || snapshots.size === 1),
      "Include the displayed list code; otherwise request a fresh list"
    );
    const id = intent.list ?? snapshots.keys().next().value;
    return selectReferences(
      snapshots.get(id!),
      c.subject,
      c.conversation,
      intent.refs ?? [],
      this.now()
    );
  }
  async run(
    c: Context,
    intent: Intent,
    adapter: LinearAdapter,
    journal: JournalClient,
    revalidate: () => Promise<Context>,
    signal?: AbortSignal,
    current: () => Promise<void> = async () => {}
  ): Promise<string> {
    requireValue(
      c.expiresAt > this.now() && !signal?.aborted,
      "Request expired"
    );
    await current();
    if (intent.kind !== "confirm") this.changed(c);
    // Purge expired sessions; no generic conversation memory or history/replay storage.
    for (const [key, values] of this.snapshots) {
      for (const [id, snapshot] of values)
        if (snapshot.expiresAt <= this.now()) values.delete(id);
      if (!values.size) this.snapshots.delete(key);
    }
    if (intent.kind === "list") {
      const result = await adapter.list(c, intent.status ?? "In Progress");
      const visible = result.issues.slice(0, 100);
      let complete = result.complete && visible.length === result.issues.length;
      while (visible.length && renderIssues(visible, complete).length > 20000) {
        visible.pop();
        complete = false;
      }
      const id = randomUUID().slice(0, 8);
      const snapshots =
        this.snapshots.get(this.key(c)) ?? new Map<string, Snapshot>();
      // Multiple live lists require an explicit code: out-of-order/dropped replies cannot change references silently.
      requireValue(
        snapshots.size < 5 && this.snapshots.size < 1000,
        "Too many active lists; wait for older lists to expire"
      );
      const snapshot = {
        subject: c.subject,
        conversation: c.conversation,
        expiresAt: this.now() + 5 * 60000,
        issues: visible,
      };
      this.pending.set(this.key(c), () => {
        snapshots.set(id, snapshot);
        this.snapshots.set(this.key(c), snapshots);
      });
      const missing = result.absentTeams?.length
        ? `\nNo exact ${escapeText(
            intent.status ?? "In Progress"
          )} state in: ${result.absentTeams
            .map((id) =>
              escapeText(c.teams?.find((t) => t.id === id)?.name ?? id)
            )
            .join(", ")}.`
        : "";
      return `${escapeText(c.employeeName ?? "Employee")} — ${renderIssues(
        visible,
        complete
      )}${missing}\nList code: ${id}`;
    }
    if (intent.kind === "details") {
      const rows = await this.references(c, intent, adapter);
      const details = [];
      for (const row of rows) {
        const current = await adapter.get(c, row.id);
        details.push(
          `${escapeText(current.identifier)}: ${escapeText(
            current.title
          )}\n${escapeText(
            current.description ?? "No description."
          )}\nStatus: ${escapeText(current.status)}`
        );
      }
      const text = details.join("\n\n");
      return text.length <= 23000
        ? text
        : `${text.slice(0, 23000)}\nDetails truncated at the reply limit.`;
    }
    if (intent.kind === "cancel") {
      const op = await journal.cancel(intent.id);
      return op.status === "cancelled" ? "Cancelled." : this.outcomes(op);
    }
    requireValue(c.writesEnabled, "Writes are disabled.");
    if (intent.kind === "confirm") {
      const shortcut = this.confirmations.get(this.key(c));
      requireValue(
        intent.id || (shortcut && shortcut.expiresAt > this.now()),
        "Request a fresh preview before confirming."
      );
      this.confirmations.delete(this.key(c));
      return this.confirm(
        c,
        intent.id ?? shortcut!.id,
        adapter,
        journal,
        revalidate,
        signal,
        current
      );
    }
    const fields = validateFields(intent.fields);
    const items: Item[] = [];
    const preview: string[] = [];
    if (intent.kind === "create") {
      const matches = (
        c.teams ?? c.teamIds.map((id) => ({ id, name: id, key: id }))
      ).filter((t) =>
        [t.id, t.name, t.key].some(
          (v) => v.trim().toLowerCase() === intent.teamId.trim().toLowerCase()
        )
      );
      requireValue(
        matches.length === 1 &&
          c.teamIds.includes(matches[0].id) &&
          !!fields.title,
        "Specify one permitted team name or key; the team is missing or ambiguous."
      );
      const teamId = matches[0].id;
      const { status, ...rest } = fields;
      const state = status ? await adapter.state(teamId, status) : undefined;
      items.push({
        kind: "create",
        args: {
          ...rest,
          team: teamId,
          assignee: c.linearUserId,
          ...(state ? { state } : {}),
        },
        ...(status ? { stateName: status } : {}),
      });
      preview.push(
        `Create in team ${escapeText(
          matches[0].name
        )}, assigned to you: ${escapeText(JSON.stringify(fields))}`
      );
    } else {
      for (const row of await this.references(c, intent, adapter)) {
        const current = await adapter.get(c, row.id);
        const { status, ...rest } = fields;
        const state = status
          ? await adapter.state(current.teamId, status)
          : undefined;
        items.push({
          kind: "edit",
          teamId: current.teamId,
          expectedUpdatedAt: current.updatedAt,
          args: { id: current.id, ...rest, ...(state ? { state } : {}) },
          ...(status ? { stateName: status } : {}),
        });
        preview.push(`Edit ${escapeText(current.identifier)}`);
      }
      preview.push(`Changes to each: ${escapeText(JSON.stringify(fields))}`);
    }
    requireValue(
      preview.join("\n").length < 23000,
      "Preview too long; request a smaller change"
    );
    await current();
    const op = await journal.prepare(items);
    requireValue(
      op.status === "pending" && op.hash === digest(items),
      "Preview unavailable"
    );
    this.pending.set(this.key(c), () =>
      this.confirmations.set(this.key(c), {
        id: op.id,
        expiresAt: op.expiresAt,
      })
    );
    return `${preview.join(
      "\n"
    )}\nReply yes or confirm within 5 minutes.\nConfirm ${
      op.id
    }\nTo stop: cancel ${op.id}`;
  }
  private outcomes(op: Operation): string {
    return op.results
      .map(
        (r, i) =>
          `${i + 1}. ${
            r.status === "success"
              ? `Saved${r.issueId ? ` (${escapeText(r.issueId)})` : ""}.`
              : r.status === "skipped" || r.status === "not_dispatched"
              ? "Not executed; no retry will run."
              : "Outcome unknown; administrator reconciliation required. Do not repeat this write."
          }`
      )
      .join("\n");
  }
  private async confirm(
    c: Context,
    id: string,
    adapter: LinearAdapter,
    journal: JournalClient,
    revalidate: () => Promise<Context>,
    signal?: AbortSignal,
    current: () => Promise<void> = async () => {}
  ) {
    const pending = await journal.lookup(id);
    await current();
    requireValue(
      pending.hash === digest(pending.items),
      "Confirmation content changed"
    );
    if (pending.status !== "pending") return this.outcomes(pending);
    requireValue(pending.expiresAt > this.now(), "Confirmation expired");
    const claimed = await journal.claim(id, pending.hash);
    if (!claimed.claimed) return this.outcomes(claimed.operation);
    for (let index = 0; index < pending.items.length; index++) {
      const item = pending.items[index];
      let dispatched = false;
      try {
        requireValue(!signal?.aborted, "Cancelled");
        const fresh = await revalidate();
        requireValue(
          fresh.writesEnabled &&
            fresh.botId === c.botId &&
            fresh.schemaHash === c.schemaHash &&
            fresh.requestId === c.requestId &&
            fresh.subject === c.subject &&
            fresh.accountId === c.accountId &&
            fresh.linearUserId === c.linearUserId &&
            fresh.workspaceId === c.workspaceId &&
            fresh.connectionId === c.connectionId &&
            fresh.appActorId === c.appActorId &&
            fresh.interactionId === c.interactionId &&
            fresh.expiresAt > this.now()
        );
        const teamId =
          item.kind === "create" ? String(item.args.team) : item.teamId;
        requireValue(fresh.teamIds.includes(teamId));
        if (item.kind === "edit") {
          const current = await adapter.get(fresh, String(item.args.id));
          requireValue(
            current.teamId === teamId &&
              current.updatedAt === item.expectedUpdatedAt,
            "Issue changed since preview"
          );
        } else requireValue(item.args.assignee === fresh.linearUserId);
        if (item.stateName)
          requireValue(
            (await adapter.state(teamId, item.stateName)) === item.args.state
          );
        requireValue(!signal?.aborted);
        // A durable dispatched marker precedes the external call. Failure to record it prevents dispatch.
        await journal.record(id, index, { status: "dispatched" });
        await current();
        requireValue(!signal?.aborted, "Interaction ended");
        dispatched = true;
        const raw = (await adapter.save(item.args)) as any;
        const saved = raw.issue ?? raw;
        requireValue(
          raw.success !== false &&
            typeof saved.id === "string" &&
            (item.kind === "create" || saved.id === item.args.id),
          "Unverified mutation outcome"
        );
        await journal.record(id, index, {
          status: "success",
          issueId: saved.id,
        });
      } catch {
        // Even if persistence itself fails, consumed/dispatched markers prevent replay after restart.
        try {
          await journal.record(id, index, {
            status: dispatched ? "unknown" : "skipped",
          });
        } catch {
          /* durable consumed status is the fallback */
        }
        if (dispatched) break; // no further mutations after an uncertain result
      }
    }
    return this.outcomes(await journal.lookup(id));
  }
}
