import { createHash } from "node:crypto";

export interface Actor {
  subject: string;
  accountId: string;
  linearUserId: string;
  workspaceId: string;
  teamIds: string[];
  teams?: { id: string; name: string; key: string }[];
  employeeName?: string;
}
export interface Context extends Actor {
  botId: string;
  connectionId: string;
  appActorId: string;
  conversation: string;
  requestId: string;
  expiresAt: number;
  writesEnabled: boolean;
  schemaHash: string;
  interactionId: string;
}
export interface Issue {
  id: string;
  identifier: string;
  title: string;
  url: string;
  assigneeId: string;
  teamId: string;
  stateId: string;
  status: string;
  updatedAt: string;
  description?: string;
  priority?: number;
  dueDate?: string | null;
}
export interface Snapshot {
  subject: string;
  conversation: string;
  expiresAt: number;
  issues: Issue[];
}
export type Fields = {
  title?: string;
  description?: string;
  priority?: number;
  dueDate?: string | null;
  status?: string;
};

export class PolicyError extends Error {}
export function requireValue(
  condition: unknown,
  code = "Request cannot be verified"
): asserts condition {
  if (!condition) throw new PolicyError(code);
}
export const normalized = (value: string) => value.trim().toLowerCase();
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${canonical(
            (value as Record<string, unknown>)[k]
          )}`
      )
      .join(",")}}`;
  return JSON.stringify(value);
}
export const digest = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
export const plain = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
export function validateFields(value: unknown): Fields {
  requireValue(
    plain(value) && Object.keys(value).length > 0,
    "Specify changes"
  );
  const allowed = ["title", "description", "priority", "dueDate", "status"];
  requireValue(
    Object.keys(value).every((key) => allowed.includes(key)),
    "Field is not permitted"
  );
  for (const key of ["title", "description", "status"])
    if (key in value) {
      requireValue(
        typeof value[key] === "string" &&
          (key === "description" || (value[key] as string).trim().length > 0)
      );
      requireValue(
        (value[key] as string).length <= (key === "description" ? 10000 : 300)
      );
    }
  if ("priority" in value)
    requireValue(
      Number.isInteger(value.priority) &&
        Number(value.priority) >= 0 &&
        Number(value.priority) <= 4
    );
  if ("dueDate" in value && value.dueDate !== null) {
    requireValue(
      typeof value.dueDate === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(value.dueDate)
    );
    const date = new Date(`${value.dueDate}T00:00:00Z`);
    requireValue(
      !isNaN(date.getTime()) &&
        date.toISOString().slice(0, 10) === value.dueDate
    );
  }
  return structuredClone(value) as Fields;
}
export function validateIssue(
  value: unknown,
  actor: Actor,
  status?: string
): Issue {
  requireValue(plain(value));
  for (const key of [
    "id",
    "identifier",
    "title",
    "url",
    "assigneeId",
    "teamId",
    "stateId",
    "status",
    "updatedAt",
  ]) {
    requireValue(
      typeof value[key] === "string" && (value[key] as string).length > 0
    );
  }
  requireValue(
    value.assigneeId === actor.linearUserId &&
      actor.teamIds.includes(value.teamId as string),
    "Issue outside permitted scope"
  );
  if (status)
    requireValue(
      normalized(value.status as string) === normalized(status),
      "Result status mismatch"
    );
  const url = new URL(value.url as string);
  requireValue(
    url.protocol === "https:" &&
      url.hostname === "linear.app" &&
      !url.username &&
      !url.password
  );
  requireValue(!isNaN(Date.parse(value.updatedAt as string)));
  // Copy only the normalized contract, never pass arbitrary provider fields to the model.
  return Object.fromEntries(
    [
      "id",
      "identifier",
      "title",
      "url",
      "assigneeId",
      "teamId",
      "stateId",
      "status",
      "updatedAt",
      "description",
      "priority",
      "dueDate",
    ]
      .filter((k) => value[k] !== undefined)
      .map((k) => [k, value[k]])
  ) as unknown as Issue;
}
export const escapeText = (s: string) =>
  s.replace(/[\r\n\u0000-\u001f]/g, " ").replace(/[\\`*_{}\[\]<>!|#]/g, "\\$&");
export function renderIssues(issues: Issue[], complete: boolean): string {
  if (!issues.length && complete) return "0 tasks — no matching tasks.";
  const count = `${issues.length} task${issues.length === 1 ? "" : "s"}`;
  return (
    `${
      complete
        ? count
        : `Partial result: ${count} shown; the full count is unavailable.`
    }\n` +
    issues
      .map(
        (v, i) =>
          `${i + 1}. [${escapeText(v.identifier)}](${new URL(v.url).href
            .replace(/\(/g, "%28")
            .replace(/\)/g, "%29")}) ${escapeText(v.title)}`
      )
      .join("\n")
  );
}
export function selectReferences(
  snapshot: Snapshot | undefined,
  subject: string,
  conversation: string,
  refs: number[],
  now = Date.now()
): Issue[] {
  requireValue(
    snapshot &&
      snapshot.subject === subject &&
      snapshot.conversation === conversation &&
      snapshot.expiresAt > now,
    "List expired; request a fresh list"
  );
  requireValue(
    refs.length > 0 && refs.length <= 10 && new Set(refs).size === refs.length
  );
  requireValue(
    refs.every(
      (n) => Number.isInteger(n) && n >= 1 && n <= snapshot.issues.length
    ),
    "Reference not in displayed list"
  );
  return refs.map((n) => structuredClone(snapshot.issues[n - 1]));
}
export function isLinearSh(
  botId: string,
  config?: Record<string, unknown>
): boolean {
  // A reservation can only restrict a bot. It never grants access without stable-ID enrollment.
  return (
    (!!process.env.LINEAR_SH_BOT_ID &&
      botId === process.env.LINEAR_SH_BOT_ID) ||
    config?.linearSh === true
  );
}
