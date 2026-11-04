/**
 * The card before a bot makes more than its limit (game #1662): its own words, one tap for the whole batch, nothing
 * remembered from it, and what a tap lets be made counts in the request.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolApprovals } from '../ToolApprovals';
import type { SavedAction } from '../OrbitActions';
import { ASK_KEY, type AskField } from '../ApprovalCard';
import type { GateDecision } from '../ToolGate';
import type { ToolServerEntry } from '../MCPConnector';

const ROOM = '!dm:matrix.test';
const SARA = { uuid: 'uuid-sara', name: 'Sara', matrixUserId: '@sara:matrix.test', isGuest: false };
const ENTRY: ToolServerEntry = { serverId: 's1', serverUrl: 'https://mcp.example', authType: 'none', fingerprint: 'fp-1', serverName: 'Poster Studio', title: 'Make posters' };
const ASK: Extract<GateDecision, { kind: 'ask' }> = { kind: 'ask', heading: 'makesNew', notReviewed: false, policyRevision: 4, fingerprint: 'fp-1' };
const ARGS = { prompt: 'Poster, neon arcade style', n: 12 };

class FakeOrbit {
    actions = new Map<string, SavedAction>();
    nextId = 1;
    grantLookups = 0;
    created: Array<Record<string, any>> = [];
    async cardSettings() {
        return { cardWaitMinutes: 10 };
    }
    async create(_bot: string, input: Record<string, any>) {
        this.created.push(input);
        const action = { id: `act_${this.nextId++}`, botId: 'b1', status: 'waiting', closedReason: null, revision: 1, reviewExpiresAt: '2026-11-04T12:10:00.000Z', connectionRef: input.connectionRef ?? null, ...input } as SavedAction;
        this.actions.set(action.id, action);
        return action;
    }
    async read(_bot: string, id: string) {
        return this.actions.get(id) ?? null;
    }
    async findGrant() {
        this.grantLookups++;
        return { grantId: 'g1', scope: { fixed: {}, varies: [] } };
    }
    private put(action: SavedAction, change: Partial<SavedAction>) {
        const next = { ...action, ...change, revision: action.revision + 1 };
        this.actions.set(action.id, next);
        return next;
    }
    async decide(_bot: string, id: string, input: { revision: number; decision: string }) {
        const action = this.actions.get(id)!;
        const next = input.decision === 'decline' ? this.put(action, { status: 'closed', closedReason: 'declined' }) : this.put(action, { status: 'approved' });
        return { outcome: 'decided' as const, action: next, grantId: null };
    }
    async claim(_bot: string, id: string) {
        const action = this.actions.get(id)!;
        return { claimed: true as const, action: this.put(action, { status: 'running' }), attemptId: `att_${id}` };
    }
    async finish(_bot: string, id: string) {
        return this.put(this.actions.get(id)!, { status: 'done' });
    }
    async supersede() {
        return [] as string[];
    }
    async touchGrants() {}
}

function setup(verdict: GateDecision = { kind: 'run', heading: 'makesNew', policyRevision: 4, fingerprint: 'fp-1' }) {
    const orbit = new FakeOrbit();
    const sent: Array<Record<string, any>> = [];
    const run = vi.fn(async () => [{ type: 'text', text: 'Made 12 posters' }]);
    const approvals = new ToolApprovals({
        orbit: orbit as never,
        cards: {
            send: async (_bot, _room, content) => {
                sent.push(content);
                return `$card${sent.length}`;
            },
            say: async () => undefined,
        },
        gate: { decide: vi.fn(async () => verdict) } as never,
        tools: { find: async () => ENTRY, run },
        now: () => 1_000,
    });
    return { approvals, orbit, sent, run };
}

const field = (content: Record<string, any>): AskField => (content['m.new_content'] ?? content)[ASK_KEY];
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const over = { kind: 'over', count: 12, unit: 'images', limit: 5 } as const;

let s: ReturnType<typeof setup>;
beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    s = setup();
});

describe('the card before making more than the limit', () => {
    it('shows the number in the title, the tool\'s details, and its own two buttons', async () => {
        const result = await s.approvals.propose({ botId: 'b1', roomId: ROOM, person: SARA, toolName: 'make_posters', toolTitle: 'Make posters', entry: ENTRY, args: ARGS, decision: ASK, batch: over });
        expect(result.kind).toBe('waiting');
        const card = field(s.sent[0]);
        expect(card.title).toBe('Make 12 images');
        expect(card.options.map((option) => option.label)).toEqual(['Make all 12', "Don't make"]);
        expect(card.lines).toEqual([{ label: 'Prompt', text: 'Poster, neon arcade style' }, { label: 'N', text: '12' }]);
    });

    it('is asked every time: no remembered approval covers it and none is offered', async () => {
        await s.approvals.propose({ botId: 'b1', roomId: ROOM, person: SARA, toolName: 'make_posters', entry: ENTRY, args: ARGS, decision: ASK, batch: over });
        expect(s.orbit.grantLookups).toBe(0);
        expect(s.orbit.created[0].rememberScope).toBeNull();
        expect(field(s.sent[0]).options.map((option) => option.id)).toEqual(['approve', 'decline']);
    });

    it('says what was made so far and offers to stop there', async () => {
        const batch = { kind: 'part', count: 2, unit: 'images', limit: 5, soFar: 4, names: { one: 'image', many: 'images' } } as const;
        await s.approvals.propose({ botId: 'b1', roomId: ROOM, person: SARA, toolName: 'make_posters', entry: ENTRY, args: { n: 2 }, decision: ASK, batch });
        const card = field(s.sent[0]);
        expect(card.title).toBe('Make 2 more images');
        expect(card.options.map((option) => option.label)).toEqual(['Make 2 more', 'Stop at 4']);
        expect(card.lines.slice(0, 2).map((line) => line.text)).toEqual(['4 images made for this request', '6 images, more than the 5 this bot makes without asking']);
    });

    it('makes all of them on one tap, and counts them in the request', async () => {
        await s.approvals.propose({ botId: 'b1', roomId: ROOM, person: SARA, toolName: 'make_posters', entry: ENTRY, args: ARGS, decision: ASK, batch: over });
        await s.approvals.handleTap('b1', ROOM, SARA, { ask: 'act_1', revision: 1, tap: { action: 'decide', option: 'approve' } });
        await settle();
        expect(s.run).toHaveBeenCalledTimes(1);
        expect(s.approvals.madeSoFar('b1', ROOM, SARA)).toBe(12);
        // The next step of the request is over the limit again, with 12 already made
        expect(s.approvals.reserveMake('b1', ROOM, SARA, 1, 5)).toEqual({ ok: false, soFar: 12 });
    });

    it('holds a card rebuilt after a restart to the same checks and counts, with no memory of the card', async () => {
        await s.approvals.propose({ botId: 'b1', roomId: ROOM, person: SARA, toolName: 'make_posters', entry: ENTRY, args: ARGS, decision: ASK, batch: over });
        // A new process: it holds no cards, only what Orbit saved
        const fresh = setup({ kind: 'run', heading: 'makesNew', policyRevision: 4, fingerprint: 'fp-1' });
        fresh.orbit.actions = s.orbit.actions;
        await fresh.approvals.handleTap('b1', ROOM, SARA, { ask: 'act_1', revision: 1, tap: { action: 'decide', option: 'approve' } });
        await settle();
        expect(fresh.run).toHaveBeenCalledTimes(1);
        expect(fresh.approvals.madeSoFar('b1', ROOM, SARA)).toBe(12);
        // And a changed setting stops it, as for a card it still held
        const changed = setup({ kind: 'run', heading: 'makesNew', policyRevision: 9, fingerprint: 'fp-1' });
        await s.approvals.propose({ botId: 'b1', roomId: ROOM, person: SARA, toolName: 'make_posters', entry: ENTRY, args: { ...ARGS, prompt: 'other' }, decision: ASK, batch: over });
        changed.orbit.actions = s.orbit.actions;
        await changed.approvals.handleTap('b1', ROOM, SARA, { ask: 'act_2', revision: 1, tap: { action: 'decide', option: 'approve' } });
        await settle();
        expect(changed.run).not.toHaveBeenCalled();
    });

    it('does not count the batch when the tool proved it made nothing', async () => {
        s.run.mockResolvedValueOnce({ error: 'The server refused it.', outcome: 'not_sent' } as never);
        await s.approvals.propose({ botId: 'b1', roomId: ROOM, person: SARA, toolName: 'make_posters', entry: ENTRY, args: ARGS, decision: ASK, batch: over });
        await s.approvals.handleTap('b1', ROOM, SARA, { ask: 'act_1', revision: 1, tap: { action: 'decide', option: 'approve' } });
        await settle();
        expect(s.run).toHaveBeenCalledTimes(1);
        expect(s.approvals.madeSoFar('b1', ROOM, SARA)).toBe(0);
    });

    it('makes nothing and counts nothing when the person says don\'t', async () => {
        await s.approvals.propose({ botId: 'b1', roomId: ROOM, person: SARA, toolName: 'make_posters', entry: ENTRY, args: ARGS, decision: ASK, batch: over });
        await s.approvals.handleTap('b1', ROOM, SARA, { ask: 'act_1', revision: 1, tap: { action: 'decide', option: 'decline' } });
        await settle();
        expect(s.run).not.toHaveBeenCalled();
        expect(s.approvals.madeSoFar('b1', ROOM, SARA)).toBe(0);
    });

    it('does not make them if the settings changed since the card was shown', async () => {
        const changed = setup({ kind: 'run', heading: 'makesNew', policyRevision: 9, fingerprint: 'fp-1' });
        await changed.approvals.propose({ botId: 'b1', roomId: ROOM, person: SARA, toolName: 'make_posters', entry: ENTRY, args: ARGS, decision: ASK, batch: over });
        await changed.approvals.handleTap('b1', ROOM, SARA, { ask: 'act_1', revision: 1, tap: { action: 'decide', option: 'approve' } });
        await settle();
        expect(changed.run).not.toHaveBeenCalled();
    });

    it('shows the same card again on Review again, from a tool that runs right away', async () => {
        await s.approvals.propose({ botId: 'b1', roomId: ROOM, person: SARA, toolName: 'make_posters', entry: ENTRY, args: ARGS, decision: ASK, batch: over });
        await s.approvals.handleTap('b1', ROOM, SARA, { ask: 'act_1', revision: 1, tap: { action: 'close' } });
        await s.approvals.handleTap('b1', ROOM, SARA, { ask: 'act_1', revision: 2, tap: { action: 'reviewAgain' } });
        const again = field(s.sent[s.sent.length - 1]);
        expect(again.title).toBe('Make 12 images');
        expect(again.answer).toBeUndefined();
    });
});

describe('what a request has made', () => {
    it('starts again when the person writes a new message', async () => {
        s.approvals.reserveMake('b1', ROOM, SARA, 5, 5);
        await s.approvals.onPersonMessage('b1', ROOM, SARA);
        expect(s.approvals.madeSoFar('b1', ROOM, SARA)).toBe(0);
        expect(s.approvals.reserveMake('b1', ROOM, SARA, 5, 5)).toEqual({ ok: true });
    });

    it('is kept apart for each person, bot and chat', () => {
        s.approvals.reserveMake('b1', ROOM, SARA, 5, 5);
        expect(s.approvals.madeSoFar('b2', ROOM, SARA)).toBe(0);
        expect(s.approvals.madeSoFar('b1', ROOM, { uuid: 'uuid-omar' })).toBe(0);
        expect(s.approvals.madeSoFar('b1', '!other:matrix.test', SARA)).toBe(0);
        // The same person in a bubble is another chat
        expect(s.approvals.madeSoFar('b1', ROOM, { ...SARA, playerId: 3 })).toBe(0);
    });
});
