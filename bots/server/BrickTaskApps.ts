/**
 * The Apps a goal's, watch's or briefing's run may use (game #2002). Setting one grants nothing (check 43): a run uses an App exactly as the
 * owner's own chat would, under the same four headings, with the same check right before every call, and with these two differences that make
 * it stricter, because nobody is watching it:
 *
 *  - A step that makes something new, or sends or deletes, asks for this occurrence on a card, whatever the setting says ("Right away" in
 *    chat is not "right away" with nobody there). Off blocks it, asking first asks, and nothing is remembered from such a card.
 *  - An App nobody reviewed is not used at all: in chat a manager may try one, on a card; a run has no manager to try it.
 *
 * The card is in the person's own chat with the Brick, in the goal's own conversation (`task:{itemId}`), so what they write in chat never
 * touches it. It is the message: the run ends there and says nothing more of it. The same step asked again on a later check joins the card
 * that waits. When it is tapped, the step runs once, by Orbit's claim, and only while the goal is still going.
 *
 * Pure of the AI and of the chat: the tools, the gate, the cards and the call are somebody else's (injected).
 */
import { createHash } from 'crypto';
import { SCRUBBED_LOOKUPS, batchOf, batchParts, isBatchTool, isOffRow, ownCopyLine, ownCopyOf, ownerOfAction, whichAppLine, withoutOff } from '../mcp/AppActions';
import { actionName } from '../mcp/AppBatch';
import { isJoinedLookup, joinLookupAnswers, lookupRequests, sessionRefused, withoutSession } from '../mcp/AppLookups';
import type { ToolServerEntry } from '../mcp/MCPConnector';
import type { GateCall, GateDecision, ToolGate } from '../mcp/ToolGate';
import { TASK_ALWAYS_ASK, type ProposeInput, type Proposed } from '../mcp/ToolApprovals';
import type { ToolHeading } from '../mcp/ToolCatalog';
import type { DueRun } from './BrickRunner';
import { FINISH_CHECK_TOOL, READ_PAGE_TOOL, type ToolDefinition } from './BrickTaskRun';
import { fitAppAnswer, isMailTool, RUN_ANSWER_MAX } from './BrickAppAnswer';

/**
 * What an App's answer to a step can be at most, as text for the model: the room a chat reply has. An answer longer than that is first
 * made smaller (encoded bodies and raw HTML out), then shortened by whole items, and only then cut, and it always says so (BrickAppAnswer).
 */
export const APP_RESULT_MAX = RUN_ANSWER_MAX;

export interface TaskAppsDeps {
    /** The tools the Brick's Apps give, and where each one lives. Throws when they cannot be listed. */
    discover(brickId: string): Promise<{ tools: ToolDefinition[]; servers: Map<string, ToolServerEntry> }>;
    /** `appPolicy`, when given, reads a ready-made App's actions, so an action Off in it is taken out of what the link's lookups answer. */
    gate: Pick<ToolGate, 'decide'> & Partial<Pick<ToolGate, 'appPolicy'>>;
    approvals: { propose(input: ProposeInput): Promise<Proposed> };
    /** The person's own chat with the Brick, where the card goes; never made here. */
    room(brickId: string, matrixUserId: string): Promise<{ ok: true; roomId: string } | { ok: false; reason: 'no_chat' | 'not_allowed' | 'unsure' }>;
    /** One call to the tool as an owner's chat would make it (an App on a connection is checked again with Orbit right before it runs). */
    call(brickId: string, entry: ToolServerEntry, toolName: string, args: Record<string, unknown>, ownerId: string, use: { heading: ToolHeading; callId: string }): Promise<unknown>;
}

/** What one run may do with the Apps: the tools to offer the model, and what each call does. */
export interface TaskAppsSession {
    definitions: ToolDefinition[];
    has(name: string): boolean;
    /** The result as text for the model. Never throws. */
    call(name: string, args: Record<string, unknown>): Promise<string>;
    /** Whether a card for this check is waiting for the person's OK: the card is the message, and nothing else is done in the check. */
    waiting(): boolean;
}

const asText = (value: unknown, mail: boolean): string => {
    try {
        return fitAppAnswer(value, APP_RESULT_MAX, mail);
    } catch {
        return JSON.stringify({ error: 'That gave back something that cannot be read.' });
    }
};

const HELD_BY_CARD = JSON.stringify({ error: "A card is already waiting for the person's OK in this check, so nothing else is done now. End the check with finish_check (nothing_new) and say nothing about the card." });

const refused = (line: string): string => JSON.stringify({ error: `${line} This was not done, and it cannot be done another way. Say so plainly if it matters.` });

/** The step's own id for this run: the same step in a run that is tried again is the same call, so it is never made twice. */
const stepId = (runId: string, toolName: string, args: Record<string, unknown>): string => `${runId}:${createHash('sha256').update(JSON.stringify([toolName, args])).digest('hex').slice(0, 24)}`;

export class TaskApps {
    constructor(private readonly deps: TaskAppsDeps) {}

    /** The Apps this run may use: every tool the gate does not refuse for the owner, and none an unreviewed App gives. Null when there are none. */
    async open(run: DueRun): Promise<TaskAppsSession | null> {
        let found: Awaited<ReturnType<TaskAppsDeps['discover']>>;
        try {
            found = await this.deps.discover(run.brickId);
        } catch (error) {
            // The Apps cannot be listed just now: the run goes on with what it can do without them
            console.warn(`[TaskApps] Could not list the Apps of ${run.brickId}:`, error instanceof Error ? error.message : error);
            return null;
        }
        const offered: ToolDefinition[] = [];
        const servers = new Map<string, ToolServerEntry>();
        await Promise.all(
            found.tools.map(async (tool) => {
                const name = tool.function.name;
                // The run's own two tools are never an App's
                if (name === READ_PAGE_TOOL || name === FINISH_CHECK_TOOL) return;
                const entry = found.servers.get(name);
                if (!entry) return;
                // A batch of several Apps is offered when any of them allows it: its actions go to their own Apps when it is called
                const judged = isBatchTool(name) && entry.otherApps?.length ? [entry, ...entry.otherApps] : [entry];
                const verdicts = await Promise.all(judged.map(async (app) => (await this.decideFor(run, name, app)).verdict));
                // A ready-made App's batch tool is offered as it is: each call brings its actions, judged one by one when it is made
                const offeredBatch = (verdict: GateDecision) => isBatchTool(name) && verdict.kind === 'run' && !verdict.heading;
                if (verdicts.some((verdict) => offeredBatch(verdict) || this.refusal(verdict, name) === null)) {
                    offered.push(tool);
                    servers.set(name, entry);
                }
            })
        );
        if (offered.length === 0) return null;
        offered.sort((a, b) => a.function.name.localeCompare(b.function.name));
        // One card ends the check: a model that asks for more steps in the same round does not get them
        const state = { waiting: false };
        return {
            definitions: offered,
            has: (name) => servers.has(name),
            call: (name, args) => (state.waiting ? Promise.resolve(HELD_BY_CARD) : this.call(run, name, args, servers.get(name), state)),
            waiting: () => state.waiting,
        };
    }

    /** What a ready-made App's own lookups answer (its search, its schemas) never shows an action that is Off in any of the Brick's Apps, as in chat. */
    private async withoutOffActions(brickId: string, name: string, entry: ToolServerEntry, answer: unknown): Promise<unknown> {
        const readPolicy = this.deps.gate.appPolicy?.bind(this.deps.gate);
        if (!readPolicy || !SCRUBBED_LOOKUPS.has(name.trim().toUpperCase())) return answer;
        const apps = [entry, ...(entry.otherApps ?? [])].filter((app) => app.readyMade);
        if (apps.length === 0) return answer;
        const policies = (await Promise.all(apps.map((app) => readPolicy(brickId, app.serverId)))).filter((policy) => !!policy);
        return policies.length > 0 ? withoutOff(answer, (slug) => policies.some((policy) => isOffRow(policy!, slug))) : answer;
    }

    /**
     * The gate's verdict on a tool, and the App the step goes through. A link tool that several ready-made Apps share (their search,
     * schemas, connections) goes through the first of them that lets it be used, as in chat; a batch goes through the App it was routed to.
     */
    private async decideFor(run: DueRun, name: string, entry: ToolServerEntry, args?: Record<string, unknown>): Promise<{ app: ToolServerEntry; verdict: GateDecision }> {
        // The person's own App comes first under its name (own Apps first); an Off there never takes the tool from the ready-made Apps beside it
        const apps = entry.otherApps?.length && !isBatchTool(name) ? [entry, ...entry.otherApps] : [entry];
        let first: { app: ToolServerEntry; verdict: GateDecision } | undefined;
        for (const app of apps) {
            // eslint-disable-next-line no-await-in-loop
            const verdict = await this.deps.gate.decide(this.gateCall(run, name, app, args));
            first ??= { app, verdict };
            if (this.refusal(verdict, name) === null) return { app, verdict };
        }
        return first!;
    }

    private gateCall(run: DueRun, toolName: string, entry: ToolServerEntry, args?: Record<string, unknown>): GateCall {
        return {
            botId: run.brickId,
            toolName,
            // What the call asks for, where it changes the verdict: a batch's actions, reconnecting an App
            ...(args !== undefined ? { args } : {}),
            ...(entry.title ? { toolTitle: entry.title } : {}),
            serverId: entry.serverId,
            ...(entry.fingerprint ? { fingerprint: entry.fingerprint } : {}),
            // The owner, whose Brick it is: a run is theirs, never a visitor's
            person: { signedIn: true, identifier: run.userId },
            voice: false,
        };
    }

    /** Null when the call may go on to a run or a card; otherwise the line it is refused with. */
    private refusal(verdict: GateDecision, name: string): string | null {
        if (verdict.kind === 'refuse') return verdict.line;
        // An App nobody reviewed has no heading to judge it by: a run does not use it
        if (verdict.kind === 'ask' && verdict.notReviewed) return `${name} has not been reviewed yet, so a check cannot use it.`;
        if (verdict.kind === 'run' && (!verdict.heading || verdict.policyRevision === undefined || !verdict.fingerprint)) return `${name} has not been reviewed yet, so a check cannot use it.`;
        return null;
    }

    private async call(run: DueRun, name: string, args: Record<string, unknown>, entry: ToolServerEntry | undefined, state: { waiting: boolean }): Promise<string> {
        if (!entry) return JSON.stringify({ error: 'That is not something a check can do.' });
        // Every App under this name, for what the link's lookups answer, whichever App the step goes through
        const listed = entry;
        try {
            // A batch goes through the one App its actions belong to, holding them as they were read
            if (isBatchTool(name)) {
                const routed = await this.batchApp(run, entry, args);
                if ('line' in routed) return refused(routed.line);
                ({ app: entry, args } = routed);
            }
            // A search or a schemas request on a Brick with several Apps is asked of every App that allows it, and the answers are one
            if (isJoinedLookup(name) && entry.otherApps?.length) return await this.joinedLookup(run, name, args, entry, state);
            // The check right before the call: the tool, the person and the settings as they are now
            const decided = await this.decideFor(run, name, entry, args);
            entry = decided.app;
            const verdict = decided.verdict;
            const why = this.refusal(verdict, name);
            if (why !== null) return refused(why);
            if (verdict.kind === 'refuse') return refused(verdict.line);
            const heading = verdict.heading!;
            const asks = verdict.kind === 'ask' || TASK_ALWAYS_ASK.includes(heading);
            if (!asks) {
                const answer = await this.callWithSessionFallback(run.brickId, entry, name, args, run.userId, { heading, callId: stepId(run.runId, name, args) });
                return asText(await this.withoutOffActions(run.brickId, name, listed, answer), isMailTool(name, entry.serverName));
            }
            return await this.askFor(
                run,
                name,
                entry,
                args,
                { kind: 'ask', heading, notReviewed: false, policyRevision: verdict.policyRevision!, fingerprint: verdict.fingerprint! },
                state
            );
        } catch (error) {
            console.warn(`[TaskApps] A step of a goal or task failed (${name}):`, error instanceof Error ? error.message : error);
            return JSON.stringify({ error: 'That did not work just now.' });
        }
    }

    /**
     * One call to an App's tool, tried once more without the session id it carried when its link refused that session (the model carries the
     * session one App's link gave to another App's link). Only a refusal that names the session is tried again, only without the session,
     * and as its own try (its own call id): it is the same call, already allowed or already approved on its card.
     */
    private async callWithSessionFallback(brickId: string, entry: ToolServerEntry, name: string, args: Record<string, unknown>, ownerId: string, use: { heading: ToolHeading; callId: string }): Promise<unknown> {
        const answer = await this.deps.call(brickId, entry, name, args, ownerId, use);
        const bare = sessionRefused(answer) ? withoutSession(args) : undefined;
        return bare ? this.deps.call(brickId, entry, name, bare, ownerId, { ...use, callId: `${use.callId}:no-session` }) : answer;
    }

    /**
     * A search or a schemas request of a Brick with several Apps, as in chat: each App's link only knows its own actions, so it is asked of
     * every App the gate lets it be used through (a schemas request only of the Apps that own the actions it names) and the answers are
     * joined, oldest App first, with what is Off in any App taken out. An App that must ask first shows its card before anything is asked,
     * and the check ends with it.
     */
    private async joinedLookup(run: DueRun, name: string, args: Record<string, unknown>, first: ToolServerEntry, state: { waiting: boolean }): Promise<string> {
        const apps = [first, ...(first.otherApps ?? [])];
        const readPolicy = this.deps.gate.appPolicy?.bind(this.deps.gate);
        const policies = readPolicy ? await Promise.all(apps.map((app) => readPolicy(run.brickId, app.serverId))) : apps.map(() => null);
        const requests = lookupRequests(name, args, apps, policies);
        const decided = await Promise.all(requests.map(async ({ app, args: own }) => ({ app, args: own, verdict: await this.deps.gate.decide(this.gateCall(run, name, app, own)) })));
        const usable = decided.filter(({ verdict }) => this.refusal(verdict, name) === null);
        // No App lets it be used: the first App's refusal stands
        if (usable.length === 0) return refused(this.refusal(decided[0].verdict, name) ?? `${name} cannot be used.`);
        for (const { app, args: own, verdict } of usable) {
            const heading = verdict.kind === 'refuse' ? undefined : verdict.heading;
            if (verdict.kind === 'refuse' || !heading) continue;
            if (verdict.kind === 'ask' || TASK_ALWAYS_ASK.includes(heading)) {
                // eslint-disable-next-line no-await-in-loop
                return await this.askFor(run, name, app, own, { kind: 'ask', heading, notReviewed: false, policyRevision: verdict.policyRevision!, fingerprint: verdict.fingerprint! }, state);
            }
        }
        const step = stepId(run.runId, name, args);
        const answers = await Promise.all(
            usable.map(async ({ app, args: own, verdict }) => {
                let answer: unknown;
                try {
                    answer = await this.callWithSessionFallback(run.brickId, app, name, own, run.userId, { heading: (verdict as { heading: ToolHeading }).heading, callId: requests.length === 1 ? step : `${step}:${app.serverId}` });
                } catch (error) {
                    console.warn(`[TaskApps] A lookup of a goal or task failed (${name}):`, error instanceof Error ? error.message : error);
                    answer = { error: 'That did not work just now.' };
                }
                return { app: app.serverName ?? '', answer };
            })
        );
        return asText(await this.withoutOffActions(run.brickId, name, first, joinLookupAnswers(answers)), isMailTool(name, first.serverName));
    }

    /**
     * The App a batch step goes through, with only its actions as they were read. A step holds one App's actions: an action no App
     * clearly owns, or actions of several Apps in one step, are refused (the model asks again, one App per step). Inputs that are not a
     * batch go on as they are, for the gate to refuse.
     */
    private async batchApp(run: DueRun, first: ToolServerEntry, args: Record<string, unknown>): Promise<{ app: ToolServerEntry; args: Record<string, unknown> } | { line: string }> {
        const parts = batchParts(args);
        if (!parts) return { app: first, args };
        const apps = [first, ...(first.otherApps ?? [])];
        // An App left out for the person's own copy (own Apps first) is checked even with one App left: its action never goes through another
        const leftOut = first.ownCopyApps?.length ? first.ownCopyApps : undefined;
        if (apps.length === 1 && !leftOut) return { app: first, args: batchOf(args, parts) };
        const appPolicy = this.deps.gate.appPolicy?.bind(this.deps.gate);
        const policies = appPolicy ? await Promise.all(apps.map((app) => appPolicy(run.brickId, app.serverId))) : apps.map(() => null);
        const owners = new Map<string, ToolServerEntry>();
        for (const part of parts) {
            const owner = ownerOfAction(part.slug, apps, policies);
            // An action of the left-out App that no remaining App lists or is named by: the step uses the person's own copy instead
            const ownCopy = owner === 'none' ? ownCopyOf(part.slug, leftOut) : undefined;
            if (ownCopy) return { line: ownCopyLine(actionName(part.slug, ownCopy), ownCopy) };
            if (apps.length === 1) {
                owners.set(first.serverId, first);
                continue;
            }
            // With the owner's own server first under this name, an action no ready-made App lists or is named by goes to that server
            const app = owner === 'none' ? (first.readyMade ? undefined : first) : owner === 'unclear' ? undefined : owner;
            if (!app) return { line: whichAppLine(actionName(part.slug)) };
            owners.set(app.serverId, app);
        }
        if (owners.size > 1) return { line: `That asked for actions of ${[...owners.values()].map((app) => app.serverName || 'an App').join(' and ')} at once. Ask for each App's actions in a step of its own.` };
        return { app: [...owners.values()][0], args: batchOf(args, parts) };
    }

    /** The card for this step, in the person's own chat: it waits there, and the run only ends. */
    private async askFor(run: DueRun, name: string, entry: ToolServerEntry, args: Record<string, unknown>, decision: Extract<GateDecision, { kind: 'ask' }>, state: { waiting: boolean }): Promise<string> {
        if (!run.matrixUserId) return refused('This needs the person\'s OK on a card, and they have no chat with you to show it in.');
        const room = await this.deps.room(run.brickId, run.matrixUserId);
        if ('reason' in room) {
            return refused(room.reason === 'unsure' ? 'The card asking for the person\'s OK could not be shown just now.' : 'This needs the person\'s OK on a card, and there is no chat with them to show it in.');
        }
        const proposed = await this.deps.approvals.propose({
            botId: run.brickId,
            roomId: room.roomId,
            person: { uuid: run.userId, matrixUserId: run.matrixUserId, isGuest: false },
            toolName: name,
            ...(entry.title ? { toolTitle: entry.title } : {}),
            entry,
            args,
            decision,
            task: { itemId: run.itemId },
        });
        // A card for a goal asks for this occurrence, so a remembered approval never says "run" here
        if (proposed.kind === 'run') return refused('That could not be asked just now.');
        // A card waits (or already waited): this check ends with it
        if (proposed.kind === 'waiting') state.waiting = true;
        return JSON.stringify(proposed.result);
    }
}
