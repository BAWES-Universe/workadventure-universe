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
 *  3. A heading set to Off blocks its tools.
 *  4. Changing things and deleting or sending need their own permission (Orbit #737), whatever the setting. Asking first
 *     is not an access limit and never stands in for a permission.
 *  5. Asks first becomes a card; Right away runs.
 *
 * When Orbit can't be asked, nothing is let through, except that a recent answer stands (see ToolPolicySource).
 */
import * as Sentry from '@sentry/node';
import type { AdminApiService, BotAccessPerson } from '../server/AdminApiService';
import type { BotAccessGate } from '../server/BotAccessGate';
import { type ToolHeading } from './ToolCatalog';
import { ToolPolicySource } from './ToolPolicy';

export type GateRefusal = 'cannot_check' | 'not_confirmed' | 'changed' | 'off' | 'no_permission' | 'voice_unchecked';

export type GateDecision =
    | { kind: 'run' }
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
}

/** The permission a heading needs besides ordinary bot access, if any. */
const PERMISSION_FOR: Partial<Record<ToolHeading, 'change' | 'deleteOrSend'>> = {
    changesThings: 'change',
    deletesOrSends: 'deleteOrSend',
};

/** Who manages a bot is kept this long, so a chat does not ask Orbit for every call. */
const MANAGER_CACHE_MS = 30_000;
const MAX_REMEMBERED_MANAGERS = 2_000;
const REPORT_EVERY_MS = 60_000;

export const CANNOT_CHECK_TOOL_LINE = "I can't check that tool right now. Try again soon.";

const nameOf = (call: GateCall) => call.toolTitle || call.toolName;

const refusal = (why: GateRefusal, line: string): GateDecision => ({ kind: 'refuse', why, line });

export class ToolGate {
    private readonly managers = new Map<string, { can: boolean; at: number }>();
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
            const refused = await this.missingPermission(call, heading);
            if (refused) return refused;
            if (!call.fingerprint) return waits;
            return { kind: 'ask', heading, notReviewed: true, policyRevision: policy.policyRevision, fingerprint: call.fingerprint };
        }

        const heading = tool.heading!;
        const setting = policy.settings[heading];
        if (setting === 'off') return refusal('off', `${nameOf(call)} is turned off for this bot.`);

        const refused = await this.missingPermission(call, heading);
        if (refused) return refused;

        if (setting === 'asksFirst') {
            return { kind: 'ask', heading, notReviewed: false, policyRevision: policy.policyRevision, fingerprint: tool.fingerprint };
        }
        return { kind: 'run' };
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

    private async managesTools(botId: string, identifier: string): Promise<boolean> {
        const key = `${botId}|${identifier}`;
        const known = this.managers.get(key);
        if (known && this.now() - known.at < MANAGER_CACHE_MS) return known.can;
        const can = await this.orbit.canManageBotTools(botId, identifier);
        this.managers.delete(key);
        this.managers.set(key, { can, at: this.now() });
        while (this.managers.size > MAX_REMEMBERED_MANAGERS) {
            const oldest = this.managers.keys().next().value;
            if (oldest === undefined) break;
            this.managers.delete(oldest);
        }
        return can;
    }

    private report(error: unknown): void {
        console.error('[ToolGate] Could not check a tool:', error instanceof Error ? error.message : error);
        const now = this.now();
        if (now - this.lastReportAt < REPORT_EVERY_MS) return;
        this.lastReportAt = now;
        Sentry.captureException(error instanceof Error ? error : new Error(String(error)), { tags: { area: 'bot-tool-gate' } });
    }
}
