// Who may use a bot: the shapes Orbit's bot permissions API answers with (Orbit #427), and the small rules the bot
// page needs about them. No Svelte and no network in here, so it can be tested on its own.

export type RuleValue = "yes" | "no" | "default";
/** What a rule can say something about. `dm` is direct messages, from anywhere. */
// change and send (prototype): two new Bots permissions. Making the bot change things (a Linear issue, a post) or
// delete and send things (email, deleting) with the bot's own connections.
export type RuleAction = "chat" | "dm" | "summon" | "manage" | "change" | "send";

export interface BotRule {
    id: string;
    roleId: string | null;
    userId: string | null;
    role: { key: string; name: string; color: string } | null;
    /** For a person: their name only, Orbit keeps people's emails private */
    person: { name: string | null } | null;
    chat: RuleValue;
    dm: RuleValue;
    summon: RuleValue;
    manage: RuleValue;
    change: RuleValue;
    send: RuleValue;
}

export interface BotRole {
    id: string;
    key: string;
    name: string;
    color: string;
    builtIn: boolean;
    /** What the role gives on its own, which is what Default means for it */
    defaults: Record<RuleAction, boolean>;
}

export interface BotPermissions {
    privateBot: boolean;
    refusalReply: string | null;
    dailyReplyCap: number | null;
    rules: BotRule[];
    roles: BotRole[];
}

export const SHOWN_ACTIONS: readonly RuleAction[] = ["chat", "dm", "summon", "change", "send", "manage"];

/** Longest line Orbit keeps for people who may not chat with the bot */
export const REFUSAL_REPLY_MAX = 500;

export const EVERYONE_KEY = "everyone";

/** What a new row says about the things people do with a bot: yes, so adding someone to a Private bot lets them in */
export const NEW_ROW_VALUES: Partial<Record<RuleAction, RuleValue>> = { chat: "yes", dm: "yes", summon: "yes" };

const RULE_VALUES: readonly RuleValue[] = ["yes", "no", "default"];

function value(raw: unknown): RuleValue {
    return RULE_VALUES.includes(raw as RuleValue) ? (raw as RuleValue) : "default";
}

function text(raw: unknown): string | null {
    return typeof raw === "string" ? raw : null;
}

/** One rule as Orbit sent it; anything missing reads as Default, never as a guess */
export function readRule(raw: unknown): BotRule | undefined {
    if (!raw || typeof raw !== "object") return undefined;
    const rule = raw as Record<string, unknown>;
    if (typeof rule.id !== "string") return undefined;
    const role = rule.role as { key?: unknown; name?: unknown; color?: unknown } | null | undefined;
    const person = rule.person as { name?: unknown } | null | undefined;
    return {
        id: rule.id,
        roleId: text(rule.roleId),
        userId: text(rule.userId),
        role:
            role && typeof role.name === "string"
                ? { key: text(role.key) ?? "", name: role.name, color: text(role.color) ?? "" }
                : null,
        person: person ? { name: text(person.name) } : null,
        chat: value(rule.chat),
        dm: value(rule.dm),
        summon: value(rule.summon),
        manage: value(rule.manage),
        change: value(rule.change),
        send: value(rule.send),
    };
}

export function readPermissions(raw: unknown): BotPermissions {
    const body = (raw ?? {}) as Record<string, unknown>;
    const rules = Array.isArray(body.rules) ? body.rules.map(readRule).filter((r): r is BotRule => !!r) : [];
    const roles = Array.isArray(body.roles)
        ? body.roles.flatMap((role): BotRole[] => {
              const r = role as Record<string, unknown> | null;
              if (!r || typeof r.id !== "string" || typeof r.name !== "string") return [];
              const defaults = (r.defaults ?? {}) as Record<string, unknown>;
              return [
                  {
                      id: r.id,
                      key: text(r.key) ?? "",
                      name: r.name,
                      color: text(r.color) ?? "",
                      builtIn: r.builtIn === true,
                      defaults: {
                          chat: defaults.chat === true,
                          dm: defaults.dm === true,
                          summon: defaults.summon === true,
                          manage: defaults.manage === true,
                          change: defaults.change === true,
                          send: defaults.send === true,
                      },
                  },
              ];
          })
        : [];
    return {
        privateBot: body.privateBot === true,
        refusalReply: text(body.refusalReply),
        dailyReplyCap: typeof body.dailyReplyCap === "number" ? body.dailyReplyCap : null,
        rules,
        roles,
    };
}

/** Names the role or person a rule is for, the way Orbit's API wants it */
export function subjectOf(rule: BotRule): { roleId: string } | { userId: string } {
    return rule.roleId ? { roleId: rule.roleId } : { userId: rule.userId ?? "" };
}

/** The role or person a rule is for, as the bot page names it */
export function ruleName(rule: BotRule, someone: string): string {
    return rule.role?.name ?? rule.person?.name ?? someone;
}

/** The bot is open to everyone: no Private bot, and no rule changes who may use it */
export function isOpenToEveryone(permissions: BotPermissions): boolean {
    return !permissions.privateBot && permissions.rules.length === 0;
}

/** Roles that do not have a row on this bot yet, for the Add screen */
export function rolesWithoutRule(permissions: BotPermissions): BotRole[] {
    const taken = new Set(permissions.rules.map((rule) => rule.roleId).filter(Boolean));
    return permissions.roles.filter((role) => !taken.has(role.id));
}

/** A row that says nothing but Default everywhere adds nothing: it is the same as no row */
export function saysNothing(rule: BotRule): boolean {
    return (["chat", "dm", "summon", "manage", "change", "send"] as const).every((action) => rule[action] === "default");
}

export interface DefaultFor {
    /** What the person gets when the row says Default */
    allowed: boolean;
    /** Who gives it: a role's name, or null when it comes from nobody (or from the roles of a person we cannot see) */
    from: string | null;
}

/**
 * What Default means for one action. For a role's row it is what that role gives, or failing that what Everyone gives
 * (everyone has Everyone's permissions). A person's row follows their roles, which this page cannot see: null.
 */
export function defaultFor(action: RuleAction, rule: BotRule, roles: readonly BotRole[]): DefaultFor | null {
    if (!rule.roleId) return null;
    const own = roles.find((role) => role.id === rule.roleId);
    if (own?.defaults[action]) return { allowed: true, from: own.name };
    const everyone = roles.find((role) => role.key === EVERYONE_KEY);
    if (everyone?.defaults[action]) return { allowed: true, from: everyone.name };
    return { allowed: false, from: null };
}

export interface RuleSummaryText {
    blocked: string;
    follows: string;
    /** "Chat nearby", "Direct messages", "Summon", "Manage" */
    action: Record<RuleAction, string>;
    /** Puts what a row blocks after what it allows: "Chat nearby · Summon blocked" */
    allowsAndBlocks: (allows: string, blocks: string) => string;
    blocksOnly: (blocks: string) => string;
}

/** The line under a row on the bot page: what the row lets the role or person do */
export function ruleSummary(rule: BotRule, t: RuleSummaryText): string {
    const using = ["chat", "dm", "summon"] as const;
    const yes = SHOWN_ACTIONS.filter((action) => rule[action] === "yes").map((action) => t.action[action]);
    const no = SHOWN_ACTIONS.filter((action) => rule[action] === "no").map((action) => t.action[action]);
    if (using.every((action) => rule[action] === "no") && !yes.length) return t.blocked;
    if (yes.length && no.length) return t.allowsAndBlocks(yes.join(", "), no.join(", "));
    if (yes.length) return yes.join(", ");
    if (no.length) return t.blocksOnly(no.join(", "));
    return t.follows;
}

/** Orbit's line about a failed change, or ours when it sent none */
export function errorLine(error: unknown, fallback: string): string {
    const message = error instanceof Error ? error.message : "";
    return message && !/^API error: \d+$/.test(message) ? message : fallback;
}
