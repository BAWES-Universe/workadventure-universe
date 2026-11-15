/**
 * The card a goal or task puts up (game #2002): it is in the goal's own conversation (`task:{itemId}`), shown in the person's own chat,
 * asks every time (nothing is remembered from it), and the same step asked again on a later check joins the card that waits, with no
 * second card. Its tap runs the saved step once, also after a restart, and what the person writes in chat does not touch it.
 * Orbit is a small in-memory stand-in with the same moves.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolApprovals, type ProposeInput } from '../ToolApprovals';
import { ASK_KEY, type AskField } from '../ApprovalCard';
import type { SavedAction } from '../OrbitActions';
import type { GateDecision } from '../ToolGate';
import type { ToolServerEntry } from '../MCPConnector';

const ROOM = '!dm:matrix.test';
const ITEM = '0b8f067a-df0f-43f8-af12-8f03065ce1d0';
const SARA = { uuid: 'uuid-sara', name: 'Sara', matrixUserId: '@sara:matrix.test', isGuest: false };
const ENTRY: ToolServerEntry = { serverId: 's1', serverUrl: 'https://mcp.example', authType: 'none', fingerprint: 'fp-1', serverName: 'Linear', title: 'Create issue' };
const ASK: Extract<GateDecision, { kind: 'ask' }> = { kind: 'ask', heading: 'changesThings', notReviewed: false, policyRevision: 4, fingerprint: 'fp-1' };
const RUN: GateDecision = { kind: 'run', heading: 'changesThings', policyRevision: 4, fingerprint: 'fp-1' };
const ARGS = { team: 'WEB', title: 'Book the appointment' };

/** Orbit's saved actions: a card of a goal that asks the same thing as one that waits is that card (created false), as Orbit does. */
class FakeOrbit {
    actions = new Map<string, SavedAction>();
    grantLookups = 0;
    /** Whether a remembered approval covers a call in chat. */
    remembered = true;
    superseded: string[] = [];
    nextId = 1;
    async cardSettings() {
        return { cardWaitMinutes: 10 };
    }
    async createOrJoin(_bot: string, input: Record<string, any>) {
        const same = [...this.actions.values()].find(
            (a) => a.status === 'waiting' && a.conversationKey === input.conversationKey && a.toolName === input.toolName && JSON.stringify(a.arguments) === JSON.stringify(input.arguments)
        );
        if (same) return { action: same, created: false };
        const action = { id: `act_${this.nextId++}`, botId: 'b1', status: 'waiting', closedReason: null, revision: 1, reviewExpiresAt: new Date(1_000 + 24 * 60 * 60_000).toISOString(), ...input } as SavedAction;
        this.actions.set(action.id, action);
        return { action, created: true };
    }
    /** A chat card, as ever: its own wait, no joining. */
    async create(_bot: string, input: Record<string, any>): Promise<SavedAction> {
        const action = { id: `act_${this.nextId++}`, botId: 'b1', status: 'waiting', closedReason: null, revision: 1, reviewExpiresAt: new Date(1_000 + 10 * 60_000).toISOString(), ...input } as SavedAction;
        this.actions.set(action.id, action);
        return action;
    }
    async read(_bot: string, id: string) {
        return this.actions.get(id) ?? null;
    }
    async findGrant() {
        this.grantLookups++;
        return this.remembered ? { grantId: 'g1', scope: { fixed: {}, varies: [] } } : null;
    }
    async decide(_bot: string, id: string, input: { revision: number }) {
        const action = this.actions.get(id)!;
        if (action.status !== 'waiting' || action.revision !== input.revision) return { outcome: 'already_decided' as const, action };
        const next = { ...action, status: 'approved' as const, revision: action.revision + 1 };
        this.actions.set(id, next);
        return { outcome: 'decided' as const, action: next, grantId: null };
    }
    async claim(_bot: string, id: string) {
        const action = this.actions.get(id)!;
        if (action.status !== 'approved') return { claimed: false as const, reason: action.status, action };
        const next = { ...action, status: 'running' as const, revision: action.revision + 1 };
        this.actions.set(id, next);
        return { claimed: true as const, action: next, attemptId: `att_${id}` };
    }
    async finish(_bot: string, id: string) {
        const action = this.actions.get(id)!;
        const next = { ...action, status: 'done' as const, revision: action.revision + 1 };
        this.actions.set(id, next);
        return next;
    }
    async supersede(_bot: string, input: { conversationKey: string }) {
        const closed: string[] = [];
        for (const action of this.actions.values()) {
            if (action.conversationKey === input.conversationKey && action.status === 'waiting') {
                this.actions.set(action.id, { ...action, status: 'closed', closedReason: 'superseded' });
                closed.push(action.id);
            }
        }
        this.superseded.push(...closed);
        return closed;
    }
    async touchGrants() {}
    async revokeGrants() {}
}

function make(orbit: FakeOrbit, sent: Array<{ content: Record<string, any> }>, run = vi.fn(async () => [{ type: 'text', text: 'Created WEB-12' }]), checked: GateDecision = RUN) {
    return new ToolApprovals({
        orbit: orbit as never,
        cards: {
            send: async (_bot, _room, content) => {
                sent.push({ content });
                return `$card${sent.length}`;
            },
            say: async () => undefined,
        },
        gate: { decide: async () => checked } as never,
        tools: { find: async () => ENTRY, run },
        now: () => 1_000,
    });
}

const input = (overrides: Partial<ProposeInput> = {}): ProposeInput => ({
    botId: 'b1',
    roomId: ROOM,
    person: SARA,
    toolName: 'create_issue',
    toolTitle: 'Create issue',
    entry: ENTRY,
    args: ARGS,
    decision: ASK,
    task: { itemId: ITEM },
    ...overrides,
});
const field = (content: Record<string, any>): AskField => (content['m.new_content'] ?? content)[ASK_KEY];
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

let orbit: FakeOrbit;
let sent: Array<{ content: Record<string, any> }>;
beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    orbit = new FakeOrbit();
    sent = [];
});

describe('the card a goal puts up', () => {
    it('is in the goal’s own conversation, asks every time, and the run is told the card is the message', async () => {
        // A remembered approval that would cover a chat call covers nothing here
        const approvals = make(orbit, sent);
        const proposed = await approvals.propose(input());
        expect(proposed.kind).toBe('waiting');
        expect(orbit.grantLookups).toBe(0);
        expect(orbit.actions.get('act_1')).toMatchObject({ requesterKey: 'uuid-sara', conversationKey: `task:${ITEM}`, toolName: 'create_issue', heading: 'changesThings', rememberScope: null });
        expect(sent).toHaveLength(1);
        // The wait is Orbit's own (a day here), not the chat card's ten minutes
        expect(field(sent[0].content)).toMatchObject({ id: 'act_1', waitMinutes: 1440 });
        const told = (proposed as unknown as { result: { status: string; message: string } }).result;
        expect(told.status).toBe('waiting_for_ok');
        expect(told.message).toMatch(/finish_check/);
    });

    it('is joined by the same step on a later check: no second card, nothing new to say', async () => {
        const approvals = make(orbit, sent);
        await approvals.propose(input());
        // The next check is a new run, maybe on a server that restarted: it holds no card, and Orbit says it is the one that waits
        const later = make(orbit, sent);
        const again = await later.propose(input());
        expect(again.kind).toBe('waiting');
        expect(sent).toHaveLength(1);
        expect((again as unknown as { result: { message: string } }).result.message).toMatch(/already asked/);
        // Another step is another card
        await later.propose(input({ args: { team: 'WEB', title: 'Pay the fee' } }));
        expect(sent).toHaveLength(2);
    });

    it('is its own card for each goal, and apart from the same step asked in chat, in the same room', async () => {
        orbit.remembered = false;
        const approvals = make(orbit, sent);
        const other = '7c1d2e3f-1111-4222-8333-944455556666';
        await approvals.propose(input());
        // The same step for another goal, and the same step in chat, are not the card that waits
        await approvals.propose(input({ task: { itemId: other } }));
        await approvals.propose(input({ task: undefined }));
        expect(sent).toHaveLength(3);
        expect([...orbit.actions.values()].map((a) => a.conversationKey)).toEqual([`task:${ITEM}`, `task:${other}`, `dm:${ROOM}`]);
        // Asked again, each is still the one card of its own conversation
        await approvals.propose(input({ task: { itemId: other } }));
        await approvals.propose(input({ task: undefined }));
        expect(sent).toHaveLength(3);
    });

    it('is tapped in the person’s own chat, also after a restart, and runs the saved step once', async () => {
        await make(orbit, sent).propose(input());
        const run = vi.fn(async () => [{ type: 'text', text: 'Created WEB-12' }]);
        const restarted = make(orbit, [], run);
        const tap = { ask: 'act_1', revision: 1, tap: { action: 'decide', option: 'approve' } as never };
        await restarted.handleTap('b1', ROOM, SARA, tap);
        await settle();
        expect(run).toHaveBeenCalledTimes(1);
        expect(run).toHaveBeenCalledWith('b1', ENTRY, 'create_issue', ARGS, 'uuid-sara', expect.objectContaining({ heading: 'changesThings', callId: 'att_act_1' }));
        // A second tap does not run it again
        await restarted.handleTap('b1', ROOM, SARA, tap);
        await settle();
        expect(run).toHaveBeenCalledTimes(1);
    });

    it('is not taken by anyone else, or from a chat that is not the person’s', async () => {
        await make(orbit, sent).propose(input());
        const run = vi.fn(async () => [{ type: 'text', text: 'x' }]);
        const restarted = make(orbit, [], run);
        const tap = { ask: 'act_1', revision: 1, tap: { action: 'decide', option: 'approve' } as never };
        await restarted.handleTap('b1', ROOM, { ...SARA, uuid: 'uuid-omar' }, tap);
        await settle();
        expect(run).not.toHaveBeenCalled();
        expect(orbit.actions.get('act_1')!.status).toBe('waiting');
    });

    it('is not touched by what the person writes in chat', async () => {
        const approvals = make(orbit, sent);
        await approvals.propose(input());
        await approvals.onPersonMessage('b1', ROOM, SARA);
        expect(orbit.superseded).toEqual([]);
        expect(orbit.actions.get('act_1')!.status).toBe('waiting');
    });

    it('is never shown in a bubble, whatever the person is doing there', async () => {
        const approvals = make(orbit, sent);
        await approvals.propose(input({ person: { ...SARA, playerId: 7 } }));
        expect(orbit.actions.get('act_1')!.conversationKey).toBe(`task:${ITEM}`);
        expect(sent).toHaveLength(1);
    });
});

describe('two asks at the same moment', () => {
    it('are one card only when they are for the same goal', async () => {
        const approvals = make(orbit, sent);
        const other = '7c1d2e3f-1111-4222-8333-944455556666';
        await Promise.all([approvals.propose(input()), approvals.propose(input()), approvals.propose(input({ task: { itemId: other } }))]);
        expect([...orbit.actions.values()].map((a) => a.conversationKey).sort()).toEqual([`task:${other}`, `task:${ITEM}`].sort());
        expect(sent).toHaveLength(2);
    });
});

describe('"Review again" on a goal’s card', () => {
    const review = { ask: 'act_1', revision: 2, tap: { action: 'reviewAgain' } as never };
    const close = () => orbit.actions.set('act_1', { ...orbit.actions.get('act_1')!, status: 'closed', closedReason: 'expired', revision: 2 });

    it('is a new card for a step that makes something, though its setting says right away', async () => {
        await make(orbit, sent).propose(input({ decision: { ...ASK, heading: 'makesNew' } }));
        close();
        await make(orbit, sent, undefined, { ...RUN, heading: 'makesNew' }).handleTap('b1', ROOM, SARA, review);
        expect(sent).toHaveLength(2);
        expect([...orbit.actions.values()].map((a) => a.conversationKey)).toEqual([`task:${ITEM}`, `task:${ITEM}`]);
    });

    it('is not a card for a step that only changes things and now runs by itself', async () => {
        await make(orbit, sent).propose(input());
        close();
        await make(orbit, sent).handleTap('b1', ROOM, SARA, review);
        expect(sent).toHaveLength(1);
    });
});
