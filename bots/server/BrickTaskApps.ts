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
import type { ToolServerEntry } from '../mcp/MCPConnector';
import type { GateCall, GateDecision, ToolGate } from '../mcp/ToolGate';
import type { ProposeInput, Proposed } from '../mcp/ToolApprovals';
import type { ToolHeading } from '../mcp/ToolCatalog';
import type { DueRun } from './BrickRunner';
import { FINISH_CHECK_TOOL, READ_PAGE_TOOL, type ToolDefinition } from './BrickTaskRun';

/** What an App's answer to a step can be at most, as text for the model (the rest is cut). */
export const APP_RESULT_MAX = 12_000;

/** Headings that never run by themselves on a run: they ask for this occurrence on a card. */
const ALWAYS_ASK: readonly ToolHeading[] = ['makesNew', 'deletesOrSends'];

export interface TaskAppsDeps {
    /** The tools the Brick's Apps give, and where each one lives. Throws when they cannot be listed. */
    discover(brickId: string): Promise<{ tools: ToolDefinition[]; servers: Map<string, ToolServerEntry> }>;
    gate: Pick<ToolGate, 'decide'>;
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
}

const asText = (value: unknown): string => {
    try {
        return (typeof value === 'string' ? value : JSON.stringify(value ?? null)).slice(0, APP_RESULT_MAX);
    } catch {
        return JSON.stringify({ error: 'That gave back something that cannot be read.' });
    }
};

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
                const verdict = await this.deps.gate.decide(this.gateCall(run, name, entry));
                if (this.refusal(verdict, name) === null) {
                    offered.push(tool);
                    servers.set(name, entry);
                }
            })
        );
        if (offered.length === 0) return null;
        offered.sort((a, b) => a.function.name.localeCompare(b.function.name));
        return {
            definitions: offered,
            has: (name) => servers.has(name),
            call: (name, args) => this.call(run, name, args, servers.get(name)),
        };
    }

    private gateCall(run: DueRun, toolName: string, entry: ToolServerEntry): GateCall {
        return {
            botId: run.brickId,
            toolName,
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

    private async call(run: DueRun, name: string, args: Record<string, unknown>, entry: ToolServerEntry | undefined): Promise<string> {
        if (!entry) return JSON.stringify({ error: 'That is not something a check can do.' });
        try {
            // The check right before the call: the tool, the person and the settings as they are now
            const verdict = await this.deps.gate.decide(this.gateCall(run, name, entry));
            const why = this.refusal(verdict, name);
            if (why !== null) return refused(why);
            if (verdict.kind === 'refuse') return refused(verdict.line);
            const heading = verdict.heading!;
            const asks = verdict.kind === 'ask' || ALWAYS_ASK.includes(heading);
            if (!asks) {
                return asText(await this.deps.call(run.brickId, entry, name, args, run.userId, { heading, callId: stepId(run.runId, name, args) }));
            }
            return await this.askFor(run, name, entry, args, {
                kind: 'ask',
                heading,
                notReviewed: false,
                policyRevision: verdict.policyRevision!,
                fingerprint: verdict.fingerprint!,
            });
        } catch (error) {
            console.warn(`[TaskApps] A step of a goal or task failed (${name}):`, error instanceof Error ? error.message : error);
            return JSON.stringify({ error: 'That did not work just now.' });
        }
    }

    /** The card for this step, in the person's own chat: it waits there, and the run only ends. */
    private async askFor(run: DueRun, name: string, entry: ToolServerEntry, args: Record<string, unknown>, decision: Extract<GateDecision, { kind: 'ask' }>): Promise<string> {
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
        return JSON.stringify(proposed.result);
    }
}
