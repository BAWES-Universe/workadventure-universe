/**
 * Tests for the card in nearby chat and voice (game #1658, mock 4): the card goes to the person who asked and nobody else,
 * everyone in the bubble reads one plain line made from the tool's title and the person's name only, a yes never sends,
 * and a person who comes back gets their cards and replies again. Orbit is a small in-memory stand-in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolApprovals, type Asker, type ProposeInput } from '../ToolApprovals';
import { OrbitActionsUnavailable, type SavedAction } from '../OrbitActions';
import type { AskField } from '../ApprovalCard';
import type { GateDecision } from '../ToolGate';
import type { ToolServerEntry } from '../MCPConnector';

const SPACE = 'room#bubble';
const KHALID: Asker = { uuid: 'uuid-khalid', name: 'Khalid', playerId: 7 };
const ENTRY: ToolServerEntry = { serverId: 's1', serverUrl: 'https://mcp.example', authType: 'none', fingerprint: 'fp-1', serverName: 'Gmail', title: 'Send email' };
const ASK: Extract<GateDecision, { kind: 'ask' }> = { kind: 'ask', heading: 'deletesOrSends', notReviewed: false, policyRevision: 4, fingerprint: 'fp-1' };
const ARGS = { to: 'Fahad at Alghanim', subject: 'New launch date', body: 'Hi Fahad, our launch moves two weeks.' };

class FakeOrbit {
    actions = new Map<string, SavedAction>();
    nextId = 1;
    expiresAt = '2026-11-04T12:10:00.000Z';
    touched: string[] = [];
    private put(action: SavedAction, change: Partial<SavedAction>) {
        const next = { ...action, ...change, revision: action.revision + 1 };
        this.actions.set(action.id, next);
        return next;
    }
    async cardSettings() {
        return { cardWaitMinutes: 10 };
    }
    async create(_bot: string, input: Record<string, any>) {
        const action = { id: `act_${this.nextId++}`, botId: 'b1', status: 'waiting', closedReason: null, revision: 1, reviewExpiresAt: this.expiresAt, connectionRef: input.connectionRef ?? null, ...input } as SavedAction;
        this.actions.set(action.id, action);
        return action;
    }
    async read(_bot: string, id: string) {
        return this.actions.get(id) ?? null;
    }
    async findGrant() {
        return null;
    }
    async decide(_bot: string, id: string, input: { actorKey: string; revision: number; decision: string }) {
        const action = this.actions.get(id)!;
        if (action.requesterKey !== input.actorKey) throw new OrbitActionsUnavailable('not requester');
        if (action.status !== 'waiting' || action.revision !== input.revision) return { outcome: 'already_decided' as const, action };
        const next = input.decision === 'decline' ? this.put(action, { status: 'closed', closedReason: 'declined' }) : this.put(action, { status: 'approved' });
        return { outcome: 'decided' as const, action: next, grantId: input.decision === 'approveAndRemember' ? 'g1' : null };
    }
    async cancel(_bot: string, id: string, input: { revision: number }) {
        const action = this.actions.get(id)!;
        if (action.status !== 'waiting' || action.revision !== input.revision) return { outcome: 'already_decided' as const, action };
        return { outcome: 'changed' as const, action: this.put(action, { status: 'closed', closedReason: 'cancelled' }) };
    }
    async extend(_bot: string, id: string, input: { revision: number }) {
        const action = this.actions.get(id)!;
        return { outcome: 'changed' as const, action: this.put(action, { reviewExpiresAt: '2026-11-04T12:20:00.000Z' }), input };
    }
    async claim(_bot: string, id: string) {
        const action = this.actions.get(id)!;
        if (action.status !== 'approved') return { claimed: false as const, reason: action.status, action };
        return { claimed: true as const, action: this.put(action, { status: 'running' }), attemptId: `att_${id}` };
    }
    async finish(_bot: string, id: string, input: { outcome: string }) {
        const action = this.actions.get(id)!;
        const status = input.outcome === 'succeeded' ? 'done' : input.outcome === 'failed' ? 'failed' : input.outcome === 'uncertain' ? 'couldntConfirm' : 'approved';
        return this.put(action, { status: status as SavedAction['status'] });
    }
    async supersede(_bot: string, input: { requesterKey: string; conversationKey: string }) {
        const closed: string[] = [];
        for (const action of this.actions.values()) {
            if (action.requesterKey === input.requesterKey && action.conversationKey === input.conversationKey && action.status === 'waiting') {
                this.put(action, { status: 'closed', closedReason: 'superseded' });
                closed.push(action.id);
            }
        }
        return closed;
    }
    async touchGrants(_bot: string, input: { conversationKey: string }) {
        this.touched.push(input.conversationKey);
    }
    revoked: string[] = [];
    async revokeGrants(_bot: string, input: { conversationKey: string }) {
        this.revoked.push(input.conversationKey);
    }
}

interface Setup {
    approvals: ToolApprovals;
    orbit: FakeOrbit;
    cards: Array<{ person: Asker; ask: AskField }>;
    replies: Array<{ person: Asker; text: string; id: string }>;
    lines: string[];
    dmSent: unknown[];
    written: Array<{ system: string; prompt: string }>;
    run: ReturnType<typeof vi.fn>;
    clock: { now: number };
}

function setup(options: { write?: (prompt: string) => string | null | Promise<string | null>; runResult?: unknown; cardFails?: boolean } = {}): Setup {
    const orbit = new FakeOrbit();
    const cards: Setup['cards'] = [];
    const replies: Setup['replies'] = [];
    const lines: string[] = [];
    const dmSent: unknown[] = [];
    const written: Setup['written'] = [];
    const clock = { now: Date.parse('2026-11-04T12:00:00.000Z') };
    const run = vi.fn(async () => options.runResult ?? [{ type: 'text', text: 'Sent to fahad@example.com' }]);
    const approvals = new ToolApprovals({
        orbit: orbit as never,
        cards: {
            send: async (...args) => {
                dmSent.push(args);
                return '$dm';
            },
            say: async () => undefined,
        },
        nearby: {
            card: async (_bot, _space, person, ask) => {
                if (options.cardFails) throw new Error('not in the bubble');
                cards.push({ person, ask });
            },
            reply: async (_bot, _space, person, text, id) => void replies.push({ person, text, id }),
            say: async (_bot, _space, line) => void lines.push(line),
            write: async (_bot, system, prompt) => {
                written.push({ system, prompt });
                return options.write ? options.write(prompt) : null;
            },
        },
        gate: { decide: async () => ASK } as never,
        tools: { find: async () => ENTRY, run },
        followUp: async () => undefined,
        now: () => clock.now,
    });
    return { approvals, orbit, cards, replies, lines, dmSent, written, run, clock };
}

const input = (overrides: Partial<ProposeInput> = {}): ProposeInput => ({ botId: 'b1', roomId: SPACE, person: KHALID, toolName: 'send_email', toolTitle: 'Send email', entry: ENTRY, args: ARGS, decision: ASK, ...overrides });
const tap = (ask: string, revision: number, t: Record<string, unknown>) => ({ ask, revision, tap: t as never });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const fits = (prompt: string) => (prompt.includes('Say that you did it') ? 'Khalid, I sent the email for you.' : prompt.includes('did not do it') ? "Khalid, I didn't send the email." : prompt.includes('changed') ? 'Khalid, I changed the email and need your OK again.' : 'Khalid, I need your OK to send an email for you.');

let s: Setup;
beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    s = setup({ write: fits });
});
afterEach(() => vi.useRealTimers());

/** Proposes, then says the line that asks, as the bot's reply does: what comes after it may be said now. */
async function proposeSaid(input: Parameters<ToolApprovals['propose']>[0]) {
    const proposed = await s.approvals.propose(input);
    if (proposed.kind === 'waiting' && proposed.lineId) s.approvals.askLineSaid([proposed.lineId]);
    return proposed;
}

describe('the card in a bubble', () => {
    it('goes to the person who asked, as the same card, saved for a bubble and never as a direct message', async () => {
        const result = await proposeSaid(input());
        expect(result.kind).toBe('waiting');
        expect(s.dmSent).toHaveLength(0);
        expect(s.cards).toHaveLength(1);
        expect(s.cards[0].person.playerId).toBe(7);
        expect(s.cards[0].ask).toMatchObject({ id: 'act_1', revision: 1, title: 'Send email', actsAs: 'Gmail', everyTime: true });
        expect(s.cards[0].ask.lines.map((line) => line.text)).toContain('Hi Fahad, our launch moves two weeks.');
        expect(s.orbit.actions.get('act_1')).toMatchObject({ requesterKey: 'uuid-khalid', conversationKey: `near:${SPACE}`, toolName: 'send_email', arguments: ARGS });
        expect(s.run).not.toHaveBeenCalled();
    });

    it('tells the model one plain line for everyone to read is the whole reply, with nothing from the card in it', async () => {
        const result = (await proposeSaid(input())) as { kind: 'waiting'; result: { status: string; message: string }; line?: string };
        expect(result.result.status).toBe('waiting_for_ok');
        expect(result.result.message).toContain('Write nothing more');
        expect(result.line).toBe('Khalid, I need your OK to send an email for you.');
        // Nothing the person typed or the card holds reaches the line, or what words it
        expect(JSON.stringify(s.written)).not.toMatch(/Fahad|launch|example\.com/);
        expect(s.written[0].prompt).toContain('Tool: Send email');
        expect(s.written[0].prompt).toContain('Person: Khalid');
    });

    it('is not shown to a person who is not in the bubble: nothing is done and the saved action is closed', async () => {
        s = setup({ cardFails: true });
        const result = await proposeSaid(input());
        expect(result.kind).toBe('failed');
        expect(s.orbit.actions.get('act_1')!.status).toBe('closed');
    });

    it('asks again for nothing it already shows: the same call twice is one card', async () => {
        await proposeSaid(input());
        const again = await proposeSaid(input());
        expect(again.kind).toBe('waiting');
        expect(s.cards).toHaveLength(1);
    });

    it('is not shown at all where bubbles have no cards set up', async () => {
        const approvals = new ToolApprovals({ orbit: new FakeOrbit() as never, cards: { send: async () => '$', say: async () => undefined }, gate: { decide: async () => ASK } as never, tools: { find: async () => ENTRY, run: s.run } });
        expect((await approvals.propose(input())).kind).toBe('failed');
    });
});

describe('the line everyone reads', () => {
    it("is the title as it is when the extra AI reply fails or does not fit, never anything from the card", async () => {
        for (const write of [() => null, () => 'Khalid, I will email fahad@example.com about the launch!', () => 'Sure thing', () => { throw new Error('timeout'); }, () => '']) {
            s = setup({ write });
            const result = (await proposeSaid(input())) as { line?: string };
            expect(result.line).toBe('Khalid, I need your OK for Send email.');
        }
    });

    it('has no name to start with when the person has none', async () => {
        s = setup({ write: () => null });
        const result = (await proposeSaid(input({ person: { uuid: 'uuid-khalid', name: null, playerId: 7 } }))) as { line?: string };
        expect(result.line).toBe('I need your OK for Send email.');
    });

    it('says the email went out once it ran, for everyone, with what the tool said only on the card', async () => {
        await proposeSaid(input());
        await s.approvals.handleTap('b1', SPACE, KHALID, tap('act_1', 1, { action: 'decide', option: 'approve' }));
        await settle();
        expect(s.run).toHaveBeenCalledTimes(1);
        expect(s.lines).toEqual(['Khalid, I sent the email for you.']);
        const ended = s.cards.at(-1)!.ask;
        expect(ended.answer).toMatchObject({ option: 'approve', result: 'Sent to fahad@example.com' });
        expect(s.lines.join(' ')).not.toContain('fahad');
    });

    it("says it didn't send after Don't send, after X and after no answer, so nobody can tell which", async () => {
        await proposeSaid(input());
        await s.approvals.handleTap('b1', SPACE, KHALID, tap('act_1', 1, { action: 'decide', option: 'decline' }));
        await proposeSaid(input({ args: { ...ARGS, subject: 'Other' } }));
        await s.approvals.handleTap('b1', SPACE, KHALID, tap('act_2', 1, { action: 'close' }));
        expect(s.lines).toEqual(["Khalid, I didn't send the email.", "Khalid, I didn't send the email."]);
        expect(s.run).not.toHaveBeenCalled();
    });

    it('says how it ended only after the line that asks, even when the person taps first', async () => {
        const proposed = await s.approvals.propose(input());
        await s.approvals.handleTap('b1', SPACE, KHALID, tap('act_1', 1, { action: 'decide', option: 'decline' }));
        await settle();
        expect(s.lines).toEqual([]);
        s.approvals.askLineSaid([(proposed as { lineId?: string }).lineId!]);
        await settle();
        expect(s.lines).toEqual(["Khalid, I didn't send the email."]);
    });

    it('does not hold how it ended back for ever when the line that asks is never said', async () => {
        vi.useFakeTimers();
        try {
            await s.approvals.propose(input());
            const tapped = s.approvals.handleTap('b1', SPACE, KHALID, tap('act_1', 1, { action: 'close' }));
            await vi.advanceTimersByTimeAsync(21_000);
            await tapped;
            expect(s.lines).toEqual(["Khalid, I didn't send the email."]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('says it once when nobody answers, and the card ends as closed for lack of an answer', async () => {
        vi.useFakeTimers();
        await proposeSaid(input());
        s.clock.now = Date.parse('2026-11-04T12:10:30.000Z');
        // Orbit still has it waiting, past its time
        await vi.advanceTimersByTimeAsync(11 * 60_000);
        expect(s.lines).toEqual(["Khalid, I didn't send the email."]);
        expect(s.cards.at(-1)!.ask.answer).toEqual({ expired: true });
        // Another tap later says nothing more
        await s.approvals.handleTap('b1', SPACE, KHALID, tap('act_1', 1, { action: 'close' }));
        expect(s.lines).toHaveLength(1);
    });

    it('waits longer when the person asks for more time', async () => {
        vi.useFakeTimers();
        await proposeSaid(input());
        await s.approvals.handleTap('b1', SPACE, KHALID, tap('act_1', 1, { action: 'moreTime' }));
        s.clock.now = Date.parse('2026-11-04T12:10:30.000Z');
        await vi.advanceTimersByTimeAsync(11 * 60_000);
        // The new time (12:20) has not come, so the card is still waiting and nothing was said
        expect(s.lines).toEqual([]);
    });

    it('says nothing it cannot know when the call may have run', async () => {
        s = setup({ write: fits, runResult: { error: 'no answer', outcome: 'unknown' } });
        await proposeSaid(input());
        await s.approvals.handleTap('b1', SPACE, KHALID, tap('act_1', 1, { action: 'decide', option: 'approve' }));
        await settle();
        expect(s.lines).toEqual([]);
    });

    it("says it didn't when the call failed", async () => {
        s = setup({ write: fits, runResult: { error: 'refused', outcome: 'failed' } });
        await proposeSaid(input());
        await s.approvals.handleTap('b1', SPACE, KHALID, tap('act_1', 1, { action: 'decide', option: 'approve' }));
        await settle();
        expect(s.lines).toEqual(["Khalid, I didn't send the email."]);
    });
});

describe('what the person says while the card waits', () => {
    it('closes the card as something else said, and a new card for the same tool reads as a change', async () => {
        await proposeSaid(input());
        await s.approvals.onPersonMessage('b1', SPACE, KHALID);
        expect(s.cards.at(-1)!.ask.answer).toEqual({ typed: true });
        const result = (await proposeSaid(input({ args: { ...ARGS, body: 'Hi Fahad, it moves three weeks.' } }))) as { line?: string };
        expect(result.line).toBe('Khalid, I changed the email and need your OK again.');
        expect(s.written.at(-1)!.prompt).toContain('changed what you were going to do');
        expect(s.cards.at(-1)!.ask.id).toBe('act_2');
    });

    it('reads a new card long after as a new ask, not a change', async () => {
        await proposeSaid(input());
        await s.approvals.onPersonMessage('b1', SPACE, KHALID);
        s.clock.now += 10 * 60_000;
        const result = (await proposeSaid(input({ args: { ...ARGS, subject: 'Other' } }))) as { line?: string };
        expect(result.line).toBe('Khalid, I need your OK to send an email for you.');
    });

    it("keeps one card per tool: another person's words never close it", async () => {
        await proposeSaid(input());
        await s.approvals.onPersonMessage('b1', SPACE, { uuid: 'uuid-sara', name: 'Sara', playerId: 4 });
        expect(s.orbit.actions.get('act_1')!.status).toBe('waiting');
    });

    it("tells the label of the main button while a card waits, for the answer to a yes that never sends", async () => {
        expect(s.approvals.waitingLabel('b1', SPACE, KHALID)).toBeUndefined();
        await proposeSaid(input());
        expect(s.approvals.waitingLabel('b1', SPACE, KHALID)).toBe('Send email');
        expect(s.approvals.waitingLabel('b1', SPACE, { uuid: 'uuid-sara', name: 'Sara', playerId: 4 })).toBeUndefined();
        await s.approvals.replyPrivately('b1', SPACE, KHALID, 'Tap Send email on the card to go ahead.');
        expect(s.replies).toEqual([expect.objectContaining({ person: KHALID, text: 'Tap Send email on the card to go ahead.' })]);
        expect(s.lines).toEqual([]);
        expect(s.run).not.toHaveBeenCalled();
    });
});

describe('a tap in a bubble', () => {
    it('runs the saved call once, only for the person who asked', async () => {
        await proposeSaid(input());
        await s.approvals.handleTap('b1', SPACE, { uuid: 'uuid-sara', name: 'Sara', playerId: 4 }, tap('act_1', 1, { action: 'decide', option: 'approve' }));
        await settle();
        expect(s.run).not.toHaveBeenCalled();
        await s.approvals.handleTap('b1', SPACE, KHALID, tap('act_1', 1, { action: 'decide', option: 'approve' }));
        await s.approvals.handleTap('b1', SPACE, KHALID, tap('act_1', 1, { action: 'decide', option: 'approve' }));
        await settle();
        expect(s.run).toHaveBeenCalledTimes(1);
        expect(s.run.mock.calls[0][3]).toEqual(ARGS);
    });

    it('never shows a bubble card to a direct message or the other way round', async () => {
        await proposeSaid(input());
        // The same card id from a direct message with the same person does nothing
        await s.approvals.handleTap('b1', '!dm:matrix.test', { uuid: 'uuid-khalid', name: 'Khalid', matrixUserId: '@k:matrix.test' }, tap('act_1', 1, { action: 'close' }));
        expect(s.orbit.actions.get('act_1')!.status).toBe('waiting');
    });

    it('ends what allow more remembered in the bubble, not in a direct message, on Ask me again', async () => {
        await proposeSaid(input({ decision: { ...ASK, heading: 'changesThings' } }));
        await s.approvals.handleTap('b1', SPACE, KHALID, tap('act_1', 1, { action: 'decide', option: 'approveAndRemember' }));
        await settle();
        await s.approvals.handleTap('b1', SPACE, KHALID, tap('act_1', 2, { action: 'askAgain' }));
        await settle();
        expect(s.orbit.revoked).toEqual([`near:${SPACE}`]);
    });

    it('keeps what allow more remembered alive when the person writes in the bubble', async () => {
        await proposeSaid(input({ decision: { ...ASK, heading: 'changesThings' } }));
        s.approvals.touch('b1', SPACE, KHALID);
        expect(s.orbit.touched).toEqual([]);
        await s.approvals.handleTap('b1', SPACE, KHALID, tap('act_1', 1, { action: 'decide', option: 'approveAndRemember' }));
        await settle();
        s.approvals.touch('b1', SPACE, KHALID);
        await settle();
        expect(s.orbit.touched).toEqual([`near:${SPACE}`]);
    });
});

describe('a person who comes back to the bubble', () => {
    it('gets the card that still waits again, as the same card', async () => {
        await proposeSaid(input());
        s.cards.length = 0;
        await s.approvals.personBack('b1', SPACE, { uuid: 'uuid-khalid', name: 'Khalid', playerId: 12 });
        expect(s.cards).toHaveLength(1);
        expect(s.cards[0].person.playerId).toBe(12);
        expect(s.cards[0].ask).toMatchObject({ id: 'act_1', revision: 1 });
        expect(s.cards[0].ask.answer).toBeUndefined();
    });

    it('gets a card that ended as it ended, and the replies only they saw, once each', async () => {
        await proposeSaid(input());
        await s.approvals.replyPrivately('b1', SPACE, KHALID, 'Tap Send email on the card to go ahead.');
        await s.approvals.handleTap('b1', SPACE, KHALID, tap('act_1', 1, { action: 'close' }));
        s.cards.length = 0;
        s.replies.length = 0;
        await s.approvals.personBack('b1', SPACE, { uuid: 'uuid-khalid', name: 'Khalid', playerId: 12 });
        expect(s.cards[0].ask.answer).toEqual({ closed: true });
        expect(s.replies).toHaveLength(1);
        expect(s.replies[0].text).toBe('Tap Send email on the card to go ahead.');
    });

    it("gives nobody else's cards or replies", async () => {
        await proposeSaid(input());
        s.cards.length = 0;
        await s.approvals.personBack('b1', SPACE, { uuid: 'uuid-sara', name: 'Sara', playerId: 4 });
        expect(s.cards).toHaveLength(0);
    });

    it('every card it sends is the whole card, so the game never drops it', async () => {
        await proposeSaid(input());
        await s.approvals.handleTap('b1', SPACE, KHALID, tap('act_1', 1, { action: 'close' }));
        await s.approvals.personBack('b1', SPACE, { uuid: 'uuid-khalid', name: 'Khalid', playerId: 12 });
        for (const { ask } of s.cards) {
            expect(ask).toMatchObject({ v: 1, kind: 'approval', id: expect.any(String), revision: expect.any(Number), title: expect.any(String), lines: expect.any(Array), options: expect.any(Array), expiresAt: expect.any(Number), now: expect.any(Number), waitMinutes: expect.any(Number) });
        }
    });
});
