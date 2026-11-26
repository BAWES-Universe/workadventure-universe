/**
 * ToolGate: the one check right before any bot tool runs (game #1656, consensus J5 section 3).
 *
 * The model's tool list is only a convenience: a stale reply or a forged call still meets this. For each call, before it
 * starts, it answers one of three things:
 *
 *  - `run`: go ahead;
 *  - `ask`: it needs a person's OK on a card first (the tool asks first, or it is not confirmed yet and a manager is
 *    trying it);
 *  - `refuse`: it does not run, with a line the person can be told as it is.
 *
 * The questions, in order:
 *  1. A server that was never checked ("Not checked yet") keeps today's text behaviour and today's access checks. Voice
 *     never uses it.
 *  2. A tool nobody confirmed, or one that changed since it was confirmed, does not run for anyone but a person who
 *     manages the bot, and for them only with a card every time. The tool as it is now (its fingerprint) must be the one
 *     that was confirmed.
 *  3. A heading set to Off blocks its tools, and so does a tool set to Off on its own. A tool's own choice (Right away, Asks first,
 *     Off) wins over its heading's.
 *  4. Changing things and deleting or sending need their own permission (Orbit #737), whatever the setting. Asking first
 *     is not an access limit and never stands in for a permission.
 *  5. Asks first becomes a card; Right away runs.
 *
 * When Orbit can't be asked, nothing is let through, except that a recent answer stands (see ToolPolicySource).
 */
import * as Sentry from '@sentry/node';
import type { AdminApiService, BotAccessPerson } from '../server/AdminApiService';
import type { BotAccessGate } from '../server/BotAccessGate';
import { batchParts, isBatchTool, judgeAction, linkToolHeading, offLine, strictestOf, type BatchPart } from './AppActions';
import { type ToolHeading } from './ToolCatalog';
import { ToolPolicySource, type ServerPolicy } from './ToolPolicy';

export type GateRefusal = 'cannot_check' | 'not_confirmed' | 'changed' | 'off' | 'no_permission' | 'voice_unchecked';

export type GateDecision =
    /** Go ahead. A confirmed tool also says what it is (its heading, the settings it was judged under), for a check on how many it makes. */
    | { kind: 'run'; heading?: ToolHeading; policyRevision?: number; fingerprint?: string }
    | {
          kind: 'ask';
          heading: ToolHeading;
          /** True for a tool nobody confirmed that a manager is trying: it asks every time and nothing is remembered. */
          notReviewed: boolean;
          policyRevision: number;
          fingerprint: string;
      }
    | { kind: 'refuse'; why: GateRefusal; line: string };

export interface GateCall {
    botId: string;
    botName?: string;
    toolName: string;
    /** The tool server's own readable name for the tool, when it gave one. */
    toolTitle?: string;
    serverId: string;
    /** What the tool is right now (#1654). Without it nothing can be told to be the tool a person confirmed. */
    fingerprint?: string;
    person: BotAccessPerson;
    /** A voice bot speaking: servers that were never checked are not used. */
    voice: boolean;
    /**
     * What the call is asked with. A ready-made App's batch call is judged by each action inside it (game "Ask, Do, Ignore" for
     * Bricks): without them it is only offered, never judged as itself.
     */
    args?: unknown;
    /** The App's name, for the words of an App action's refusal ("Delete for good is off for Sam in Gmail."). */
    appName?: string;
}

/** One action of a ready-made App's batch call, and what the gate says about it on its own. */
export interface JudgedPart extends BatchPart {
    title: string;
    heading: ToolHeading;
    decision: GateDecision;
}

/**
 * What the gate says about a call as a ready-made App's batch: `whole` when it is not one (the call is judged as itself, with
 * `decide`), `refuse` when it can't run at all, or each action on its own.
 */
export type BatchVerdict = { kind: 'whole' } | { kind: 'refuse'; decision: Extract<GateDecision, { kind: 'refuse' }> } | { kind: 'parts'; parts: JudgedPart[]; policyRevision: number };

/** A batch call with nothing in it to run. */
export const NOTHING_TO_RUN_LINE = 'That asked for no action of the App, so nothing was done.';

/** The permission a heading needs besides ordinary bot access, if any. */
const PERMISSION_FOR: Partial<Record<ToolHeading, 'change' | 'deleteOrSend'>> = {
    changesThings: 'change',
    deletesOrSends: 'deleteOrSend',
};

/** Who manages a bot is kept this long, so a chat does not ask Orbit for every call. */
const MANAGER_CACHE_MS = 30_000;
const MAX_REMEMBERED_MANAGERS = 2_000;
/** After Orbit fails to say who manages a bot, the calls that follow are refused at once for this long instead of each waiting out its timeout. */
const MANAGER_RETRY_MS = 10_000;
const REPORT_EVERY_MS = 60_000;

export const CANNOT_CHECK_TOOL_LINE = "I can't check that tool right now. Try again soon.";

const nameOf = (call: GateCall) => call.toolTitle || call.toolName;

const refusal = (why: GateRefusal, line: string): GateDecision => ({ kind: 'refuse', why, line });

/**
 * Whether a call on the App link's connections tool would replace the account link the App already works with (reinitiate_all), or
 * whose inputs can't be read to tell. Only offered (no inputs yet) or a plain check is not.
 */
function replacesConnection(call: GateCall): boolean {
    if (call.toolName.trim().toUpperCase() !== 'COMPOSIO_MANAGE_CONNECTIONS' || call.args === undefined) return false;
    if (typeof call.args !== 'object' || call.args === null || Array.isArray(call.args)) return true;
    const reinitiate = (call.args as Record<string, unknown>).reinitiate_all;
    if (typeof reinitiate === 'string') return !['', 'false', '0', 'no'].includes(reinitiate.trim().toLowerCase());
    return !!reinitiate;
}

export class ToolGate {
    private readonly managers = new Map<string, { can: boolean; at: number }>();
    private readonly askingManagers = new Map<string, Promise<boolean>>();
    private readonly managerFailures = new Map<string, { error: unknown; at: number }>();
    private lastReportAt = 0;

    constructor(
        private readonly policy: ToolPolicySource,
        private readonly access: Pick<BotAccessGate, 'check'>,
        private readonly orbit: Pick<AdminApiService, 'canManageBotTools'>,
        private readonly now: () => number = Date.now
    ) {}

    /** What should happen to this call. Never throws. */
    async decide(call: GateCall): Promise<GateDecision> {
        try {
            return await this.decideNow(call);
        } catch (error) {
            this.report(error);
            return refusal('cannot_check', CANNOT_CHECK_TOOL_LINE);
        }
    }

    /** Whether the model should be offered this tool: everything but a refusal (the call is checked again when it is made). */
    async offers(call: GateCall): Promise<boolean> {
        return (await this.decide(call)).kind !== 'refuse';
    }

    private async decideNow(call: GateCall): Promise<GateDecision> {
        const policy = await this.policy.read(call.botId, call.serverId);

        // A ready-made App's grant: its rows are the App's actions, each judged on its own
        if (policy.kind === 'appActions') return this.decideApp(call, policy);

        if (policy.state === 'notCheckedYet') {
            if (call.voice) return refusal('voice_unchecked', `${nameOf(call)} can't be used by voice until this bot's tools have been reviewed.`);
            return { kind: 'run' };
        }

        const tool = policy.tools.get(call.toolName);
        // Confirmed means: a person confirmed this tool, and it is still the tool they saw
        const confirmed = !!tool && tool.confirmed && !!tool.heading && !!call.fingerprint && tool.fingerprint === call.fingerprint;

        if (!tool || !confirmed) {
            const changed = !!tool && (tool.confirmed || !!tool.heading) && !!call.fingerprint && tool.fingerprint !== call.fingerprint;
            const waits = changed
                ? refusal('changed', `${nameOf(call)} changed since it was confirmed. Someone who manages this bot needs to review it again.`)
                : refusal('not_confirmed', `${nameOf(call)} isn't confirmed yet. Someone who manages this bot needs to review it first.`);
            if (!call.person.signedIn || !call.person.identifier || !(await this.managesTools(call.botId, call.person.identifier))) return waits;
            // A manager may try a tool nobody confirmed. Their permissions still count, and the card comes every time.
            const heading = tool?.heading ?? tool?.suggestedHeading ?? 'deletesOrSends';
            // Off holds for managers too: a heading turned off lets nothing under it through, reviewed or not, and neither does a tool turned off
            // on its own. A tool's own choice was made for the tool as it was confirmed, so it never opens an Off heading for one nobody reviewed
            if (policy.settings[heading] === 'off' || tool?.setting === 'off') return refusal('off', `${nameOf(call)} is turned off for this bot.`);
            const refused = await this.missingPermission(call, heading);
            if (refused) return refused;
            if (!call.fingerprint) return waits;
            return { kind: 'ask', heading, notReviewed: true, policyRevision: policy.policyRevision, fingerprint: call.fingerprint };
        }

        const heading = tool.heading!;
        // A tool's own choice wins over its heading's (Right away, Asks first, Off), as on a ready-made App's actions
        const setting = tool.setting ?? policy.settings[heading];
        if (setting === 'off') return refusal('off', `${nameOf(call)} is turned off for this bot.`);

        const refused = await this.missingPermission(call, heading);
        if (refused) return refused;

        if (setting === 'asksFirst') {
            return { kind: 'ask', heading, notReviewed: false, policyRevision: policy.policyRevision, fingerprint: tool.fingerprint };
        }
        return { kind: 'run', heading, policyRevision: policy.policyRevision, fingerprint: tool.fingerprint };
    }

    /**
     * A ready-made App's batch call, split: each action judged on its own (Off refused, Asks first a card, Right away runs). Never
     * throws. `whole` for anything else, which `decide` judges.
     */
    async split(call: GateCall): Promise<BatchVerdict> {
        if (!isBatchTool(call.toolName)) return { kind: 'whole' };
        try {
            const policy = await this.policy.read(call.botId, call.serverId);
            if (policy.kind !== 'appActions') return { kind: 'whole' };
            const parts = batchParts(call.args);
            if (!parts) return { kind: 'refuse', decision: refusal('off', NOTHING_TO_RUN_LINE) as Extract<GateDecision, { kind: 'refuse' }> };
            const judged: JudgedPart[] = [];
            for (const part of parts) judged.push(await this.judgePart(call, policy, part));
            return { kind: 'parts', parts: judged, policyRevision: policy.policyRevision };
        } catch (error) {
            this.report(error);
            return { kind: 'refuse', decision: refusal('cannot_check', CANNOT_CHECK_TOOL_LINE) as Extract<GateDecision, { kind: 'refuse' }> };
        }
    }

    /**
     * A call on a ready-made App's grant. The link's own lookups run as they are; the batch tool is judged by the actions inside it
     * (offered when there are none to judge, refused when they can't be read); anything else is judged as an action by its name, as
     * Orbit's link does: an action saved on its own card, and any other tool of the provider (unknown: its name, else Deletes or sends out).
     */
    private async decideApp(call: GateCall, policy: ServerPolicy): Promise<GateDecision> {
        const linkHeading = linkToolHeading(call.toolName);
        if (linkHeading) {
            // The link's own tools run no action of the App, but their heading still counts: Off and the person's permissions hold
            if (policy.settings[linkHeading] === 'off') return refusal('off', `${nameOf(call)} is turned off for this bot.`);
            const refused = await this.missingPermission(call, linkHeading);
            if (refused) return refused;
            // Reconnecting an App that already works replaces its working link: that is a change like any other, and asks first when
            // Changes things does. A plain check of the connection runs as it is
            if (replacesConnection(call) && policy.settings.changesThings === 'asksFirst') {
                return { kind: 'ask', heading: 'changesThings', notReviewed: false, policyRevision: policy.policyRevision, fingerprint: call.fingerprint ?? '' };
            }
            return { kind: 'run', heading: linkHeading, policyRevision: policy.policyRevision, ...(call.fingerprint ? { fingerprint: call.fingerprint } : {}) };
        }
        if (isBatchTool(call.toolName)) {
            // Only offered: the call itself brings the actions to judge
            if (call.args === undefined) return { kind: 'run', policyRevision: policy.policyRevision, ...(call.fingerprint ? { fingerprint: call.fingerprint } : {}) };
            const parts = batchParts(call.args);
            if (!parts) return refusal('off', NOTHING_TO_RUN_LINE);
            const judged: JudgedPart[] = [];
            for (const part of parts) judged.push(await this.judgePart(call, policy, part));
            // The whole batch, as a card that holds several actions is checked again: any part that may not run stops it
            const refused = judged.find((part) => part.decision.kind === 'refuse');
            if (refused) return refused.decision;
            const heading = strictestOf(judged.map((part) => part.heading));
            // A card shows every action of the call, so it is under the strictest heading of them all
            if (judged.some((part) => part.decision.kind === 'ask')) {
                return { kind: 'ask', heading, notReviewed: false, policyRevision: policy.policyRevision, fingerprint: call.fingerprint ?? '' };
            }
            return { kind: 'run', heading, policyRevision: policy.policyRevision, ...(call.fingerprint ? { fingerprint: call.fingerprint } : {}) };
        }
        return (await this.judgePart(call, policy, { slug: call.toolName, args: {}, index: 0, raw: {} })).decision;
    }

    /** One action of a Brick's App on its own: Off is refused, permissions by heading still count, then Asks first or Right away. */
    private async judgePart(call: GateCall, policy: ServerPolicy, part: BatchPart): Promise<JudgedPart> {
        const verdict = judgeAction(policy, part.slug, call.appName);
        const judged = (decision: GateDecision): JudgedPart => ({ ...part, title: verdict.title, heading: verdict.heading, decision });
        // A batch inside a batch would hide what it runs, and the link's own tools run no action: neither is asked for inside a batch
        if (isBatchTool(part.slug) || linkToolHeading(part.slug)) {
            return judged(refusal('off', `${verdict.title} can't be asked for inside another request. Ask for each action on its own.`));
        }
        if (verdict.setting === 'off') return judged(refusal('off', offLine([verdict.title], call.botName || 'this Brick', call.appName || 'this App')));
        const refused = await this.missingPermission(call, verdict.heading);
        if (refused) return judged(refused);
        const fingerprint = call.fingerprint ?? '';
        if (verdict.setting === 'asksFirst') return judged({ kind: 'ask', heading: verdict.heading, notReviewed: false, policyRevision: policy.policyRevision, fingerprint });
        return judged({ kind: 'run', heading: verdict.heading, policyRevision: policy.policyRevision, ...(fingerprint ? { fingerprint } : {}) });
    }

    /** A ready-made App grant's policy as the gate reads it, or null for any other server (or when it can't be read). Never throws. */
    async appPolicy(botId: string, serverId: string): Promise<ServerPolicy | null> {
        try {
            const policy = await this.policy.read(botId, serverId);
            return policy.kind === 'appActions' ? policy : null;
        } catch {
            return null;
        }
    }

    /** Null when the person has what the heading needs; otherwise the refusal. */
    private async missingPermission(call: GateCall, heading: ToolHeading): Promise<GateDecision | null> {
        const action = PERMISSION_FOR[heading];
        if (!action) return null;
        const verdict = await this.access.check(call.botId, action, call.person, call.botName);
        if (verdict.kind === 'allowed') return null;
        if (verdict.kind === 'cannot_check') return refusal('cannot_check', CANNOT_CHECK_TOOL_LINE);
        return refusal('no_permission', verdict.line);
    }

    /**
     * Whether this person manages the bot's tools (Manage bots for it). False when Orbit can't say: a card is not shown on a
     * guess. `fresh` asks Orbit now instead of trusting what was said in the last half minute: for what only a manager may see.
     */
    async canManage(botId: string, identifier: string, options: { fresh?: boolean } = {}): Promise<boolean> {
        try {
            return await this.managesTools(botId, identifier, options.fresh === true);
        } catch {
            return false;
        }
    }

    private managesTools(botId: string, identifier: string, fresh = false): Promise<boolean> {
        const key = `${botId}|${identifier}`;
        const known = this.managers.get(key);
        if (known && !fresh && this.now() - known.at < MANAGER_CACHE_MS) return Promise.resolve(known.can);
        const failed = this.managerFailures.get(key);
        if (failed && this.now() - failed.at < MANAGER_RETRY_MS) return Promise.reject(failed.error);
        // Tools judged at the same moment share one question to Orbit
        const pending = this.askingManagers.get(key);
        if (pending) return pending;
        const question = this.orbit
            .canManageBotTools(botId, identifier)
            .then((can) => {
                this.managerFailures.delete(key);
                this.managers.delete(key);
                this.managers.set(key, { can, at: this.now() });
                while (this.managers.size > MAX_REMEMBERED_MANAGERS) {
                    const oldest = this.managers.keys().next().value;
                    if (oldest === undefined) break;
                    this.managers.delete(oldest);
                }
                return can;
            }, (error: unknown) => {
                this.managerFailures.delete(key);
                this.managerFailures.set(key, { error, at: this.now() });
                while (this.managerFailures.size > MAX_REMEMBERED_MANAGERS) {
                    const oldest = this.managerFailures.keys().next().value;
                    if (oldest === undefined) break;
                    this.managerFailures.delete(oldest);
                }
                throw error;
            })
            .finally(() => {
                this.askingManagers.delete(key);
            });
        this.askingManagers.set(key, question);
        return question;
    }

    private report(error: unknown): void {
        console.error('[ToolGate] Could not check a tool:', error instanceof Error ? error.message : error);
        const now = this.now();
        if (now - this.lastReportAt < REPORT_EVERY_MS) return;
        this.lastReportAt = now;
        Sentry.captureException(error instanceof Error ? error : new Error(String(error)), { tags: { area: 'bot-tool-gate' } });
    }
}
