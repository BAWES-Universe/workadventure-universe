/**
 * Tests for the card and its taps (game #1657): the card is shown and the call waits there, an approval runs the saved
 * call once after the checks run again, every other tap does what the mock says, and nothing that may have run is sent
 * again. Orbit is a small in-memory stand-in with the same moves (one winner per tap).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolApprovals, answerFor, allowedMoreLine, type Outcome, type ProposeInput } from '../ToolApprovals';
import { OrbitActionsUnavailable, type SavedAction } from '../OrbitActions';
import { ASK_KEY, type AskField } from '../ApprovalCard';
import type { GateDecision } from '../ToolGate';
import type { ToolServerEntry } from '../MCPConnector';

const ROOM = '!dm:matrix.test';
const SARA = { uuid: 'uuid-sara', name: 'Sara', matrixUserId: '@sara:matrix.test', isGuest: false };
const ENTRY: ToolServerEntry = { serverId: 's1', serverUrl: 'https://mcp.example', authType: 'none', fingerprint: 'fp-1', serverName: 'Linear', title: 'Create issue' };
const ASK: Extract<GateDecision, { kind: 'ask' }> = { kind: 'ask', heading: 'changesThings', notReviewed: false, policyRevision: 4, fingerprint: 'fp-1' };
const ARGS = { team: 'WEB', title: 'Fix login' };

/** Orbit's saved actions, in memory: the same moves, one winner for every tap. */
class FakeOrbit {
    actions = new Map<string, SavedAction>();
    attempts = new Map<string, string>();
    grants: Array<{ id: string; toolName: string; fixed: Record<string, unknown> }> = [];
    log: string[] = [];
    down = false;
    nextId = 1;
    wait = 10;
    finished: Array<{ id: string; outcome: string }> = [];
    revoked: string[] = [];
    decisionExtra: Record<string, unknown> | undefined;
    extensions = 0;

    private check() {
        if (this.down) throw new OrbitActionsUnavailable('down');
    }
    private put(action: SavedAction, change: Partial<SavedAction>) {
        const next = { ...action, ...change, revision: action.revision + 1 };
        this.actions.set(action.id, next);
        return next;
    }
    async cardSettings() {
        return { cardWaitMinutes: this.wait };
    }
    async create(_bot: string, input: Record<string, any>) {
        this.check();
        this.log.push('create');
        const action: SavedAction = { id: `act_${this.nextId++}`, botId: 'b1', status: 'waiting', closedReason: null, revision: 1, reviewExpiresAt: '2026-11-04T12:10:00.000Z', connectionRef: input.connectionRef ?? null, ...input } as SavedAction;
        this.actions.set(action.id, action);
        return action;
    }
    async read(_bot: string, id: string) {
        this.check();
        return this.actions.get(id) ?? null;
    }
    async findGrant(_bot: string, input: Record<string, any>) {
        this.check();
        const hit = this.grants.find((g) => g.toolName === input.toolName && Object.entries(g.fixed).every(([k, v]) => input.arguments[k] === v));
        return hit ? { grantId: hit.id, scope: { fixed: hit.fixed, varies: [] } } : null;
    }
    async decide(_bot: string, id: string, input: { actorKey: string; revision: number; decision: string; idleMinutes?: number; absoluteMinutes?: number }) {
        this.check();
        const action = this.actions.get(id)!;
        this.decisionExtra = { idleMinutes: input.idleMinutes, absoluteMinutes: input.absoluteMinutes };
        if (action.requesterKey !== input.actorKey) throw new OrbitActionsUnavailable('not requester');
        if (action.status !== 'waiting' || action.revision !== input.revision) return { outcome: 'already_decided' as const, action };
        const next = input.decision === 'decline' ? this.put(action, { status: 'closed', closedReason: 'declined' }) : this.put(action, { status: 'approved' });
        let grantId: string | null = null;
        if (input.decision === 'approveAndRemember') {
            grantId = `grant_${this.grants.length + 1}`;
            this.grants.push({ id: grantId, toolName: action.toolName, fixed: (action.rememberScope?.fixed as Record<string, unknown>) ?? {} });
        }
        return { outcome: 'decided' as const, action: next, grantId };
    }
    async cancel(_bot: string, id: string, input: { actorKey: string; revision: number }) {
        this.check();
        const action = this.actions.get(id)!;
        if (action.status !== 'waiting' || action.revision !== input.revision) return { outcome: 'already_decided' as const, action };
        return { outcome: 'changed' as const, action: this.put(action, { status: 'closed', closedReason: 'cancelled' }) };
    }
    async extend(_bot: string, id: string, input: { revision: number }) {
        this.check();
        const action = this.actions.get(id)!;
        if (this.extensions >= 10) return { outcome: 'no_more_time' as const };
        if (action.status !== 'waiting' || action.revision !== input.revision) return { outcome: 'already_decided' as const, action };
        this.extensions++;
        return { outcome: 'changed' as const, action: this.put(action, { reviewExpiresAt: '2026-11-04T12:20:00.000Z' }) };
    }
    async claim(_bot: string, id: string) {
        this.check();
        const action = this.actions.get(id)!;
        if (action.status !== 'approved') return { claimed: false as const, reason: action.status, action };
        this.attempts.set(id, `att_${id}`);
        return { claimed: true as const, action: this.put(action, { status: 'running' }), attemptId: `att_${id}` };
    }
    async finish(_bot: string, id: string, input: { attemptId: string; outcome: string }) {
        this.check();
        this.finished.push({ id, outcome: input.outcome });
        const action = this.actions.get(id)!;
        const status = input.outcome === 'succeeded' ? 'done' : input.outcome === 'failed' ? 'failed' : input.outcome === 'uncertain' ? 'couldntConfirm' : 'approved';
        return this.put(action, { status: status as SavedAction['status'] });
    }
    async supersede(_bot: string, input: { requesterKey: string; conversationKey: string }) {
        this.check();
        const closed: string[] = [];
        for (const action of this.actions.values()) {
            if (action.requesterKey === input.requesterKey && action.conversationKey === input.conversationKey && action.status === 'waiting') {
                this.put(action, { status: 'closed', closedReason: 'superseded' });
                closed.push(action.id);
            }
        }
        return closed;
    }
    touched = 0;
    async touchGrants() {
        this.touched++;
    }
    async revokeGrants(_bot: string, input: { reason: string }) {
        this.revoked.push(input.reason);
        this.grants = [];
    }
}

interface Setup {
    approvals: ToolApprovals;
    orbit: FakeOrbit;
    sent: Array<{ content: Record<string, any>; eventId: string }>;
    said: string[];
    outcomes: Outcome[];
    run: ReturnType<typeof vi.fn>;
    decide: ReturnType<typeof vi.fn>;
    find: ReturnType<typeof vi.fn>;
}

function setup(options: { runResult?: unknown; sendFails?: boolean; entry?: ToolServerEntry | null; verdict?: GateDecision } = {}): Setup {
    const orbit = new FakeOrbit();
    const sent: Setup['sent'] = [];
    const said: string[] = [];
    const outcomes: Outcome[] = [];
    let n = 0;
    const run = vi.fn(async () => options.runResult ?? [{ type: 'text', text: 'Created WEB-12' }]);
    const decide = vi.fn(async (): Promise<GateDecision> => options.verdict ?? ASK);
    const find = vi.fn(async () => (options.entry === undefined ? ENTRY : options.entry));
    const approvals = new ToolApprovals({
        orbit: orbit as never,
        cards: {
            send: async (_bot, _room, content) => {
                if (options.sendFails) throw new Error('matrix down');
                const eventId = `$card${n++}`;
                sent.push({ content, eventId });
                return eventId;
            },
            say: async (_bot, _room, text) => void said.push(text),
        },
        gate: { decide } as never,
        tools: { find, run },
        followUp: async (outcome) => void outcomes.push(outcome),
        now: () => 1_000,
    });
    return { approvals, orbit, sent, said, outcomes, run, decide, find };
}

const input = (overrides: Partial<ProposeInput> = {}): ProposeInput => ({ botId: 'b1', roomId: ROOM, person: SARA, toolName: 'create_issue', toolTitle: 'Create issue', entry: ENTRY, args: ARGS, decision: ASK, ...overrides });
const tap = (ask: string, revision: number, t: Record<string, unknown>) => ({ ask, revision, tap: t as never });
const field = (content: Record<string, any>): AskField => (content['m.new_content'] ?? content)[ASK_KEY];
/** Lets the detached run finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

let s: Setup;
beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    s = setup();
});

describe('showing the card', () => {
    it('saves the exact call, shows the card and tells the model it is waiting', async () => {
        const result = await s.approvals.propose(input());
        expect(result.kind).toBe('waiting');
        expect((result as unknown as { result: { status: string } }).result.status).toBe('waiting_for_ok');
        const saved = s.orbit.actions.get('act_1')!;
        expect(saved).toMatchObject({ requesterKey: 'uuid-sara', conversationKey: `dm:${ROOM}`, connectionRef: 's1', toolName: 'create_issue', heading: 'changesThings', toolFingerprint: 'fp-1', policyRevision: 4, arguments: ARGS });
        expect(saved.rememberScope).toEqual({ fixed: { team: 'WEB' }, varies: ['title'] });
        const card = field(s.sent[0].content);
        expect(card).toMatchObject({ id: 'act_1', revision: 1, title: 'Create issue', actsAs: 'Linear', waitMinutes: 10 });
        expect(card.lines).toEqual([{ label: 'Team', text: 'WEB' }, { label: 'Title', text: 'Fix login' }]);
        expect(s.run).not.toHaveBeenCalled();
    });

    it('uses the card wait the bot is set to', async () => {
        s.orbit.wait = 30;
        await s.approvals.propose(input());
        expect(field(s.sent[0].content).waitMinutes).toBe(30);
    });

    it('lets a remembered approval that covers the call run it with no card', async () => {
        s.orbit.grants.push({ id: 'g1', toolName: 'create_issue', fixed: { team: 'WEB' } });
        expect((await s.approvals.propose(input())).kind).toBe('run');
        expect(s.sent).toHaveLength(0);
        expect(s.orbit.log).not.toContain('create');
    });

    it('shows a card again for a team the approval does not cover', async () => {
        s.orbit.grants.push({ id: 'g1', toolName: 'create_issue', fixed: { team: 'WEB' } });
        expect((await s.approvals.propose(input({ args: { team: 'IOS', title: 'x' } }))).kind).toBe('waiting');
    });

    it('never looks for a remembered approval for deleting or sending, or for a tool nobody confirmed', async () => {
        s.orbit.grants.push({ id: 'g1', toolName: 'create_issue', fixed: { team: 'WEB' } });
        expect((await s.approvals.propose(input({ decision: { ...ASK, heading: 'deletesOrSends' } }))).kind).toBe('waiting');
        expect((await s.approvals.propose(input({ decision: { ...ASK, notReviewed: true } }))).kind).toBe('waiting');
        expect(s.orbit.actions.get('act_1')!.rememberScope).toBeNull();
        expect(s.orbit.actions.get('act_2')!.rememberScope).toBeNull();
        expect(field(s.sent[1].content)).toMatchObject({ notReviewed: true, everyTime: true });
    });

    it('does nothing when the card can not be shown, and closes the saved action so no tap can find it', async () => {
        s = setup({ sendFails: true });
        const result = await s.approvals.propose(input());
        expect(result.kind).toBe('failed');
        expect(s.orbit.actions.get('act_1')!.status).toBe('closed');
        expect(s.run).not.toHaveBeenCalled();
    });

    it('does nothing when Orbit can not be asked', async () => {
        s.orbit.down = true;
        expect((await s.approvals.propose(input())).kind).toBe('failed');
        expect(s.sent).toHaveLength(0);
    });
});

describe('Create (approve)', () => {
    it('runs the saved call once, tells Orbit it succeeded, and puts what came back on the card', async () => {
        await s.approvals.propose(input());
        await s.approvals.handleTap('b1', ROOM, SARA, tap('act_1', 1, { action: 'decide', option: 'approve' }));
        await settle();
        expect(s.run).toHaveBeenCalledTimes(1);
        expect(s.run).toHaveBeenCalledWith('b1', ENTRY, 'create_issue', ARGS, 'uuid-sara');
        expect(s.orbit.finished).toEqual([{ id: 'act_1', outcome: 'succeeded' }]);
        const edit = s.sent.at(-1)!.content;
        expect(edit['m.relates_to']).toEqual({ rel_type: 'm.replace', event_id: '$card0' });
        expect(field(edit).answer).toEqual({ option: 'approve', result: 'Created WEB-12' });
        expect(s.outcomes).toEqual([expect.objectContaining({ state: 'done', title: 'Create issue', result: 'Created WEB-12', person: SARA })]);
    });

    it('runs it once however many times it is tapped', async () => {
        await s.approvals.propose(input());
        const first = s.approvals.handleTap('b1', ROOM, SARA, tap('act_1', 1, { action: 'decide', option: 'approve' }));
        const second = s.approvals.handleTap('b1', ROOM, SARA, tap('act_1', 1, { action: 'decide', option: 'approve' }));
        await Promise.all([first, second]);
        await settle();
        expect(s.run).toHaveBeenCalledTimes(1);
    });

    it('checks the tool, the person and the settings again right before the call', async () => {
        await s.approvals.propose(input());
        await s.approvals.handleTap('b1', ROOM, SARA, tap('act_1', 1, { action: 'decide', option: 'approve' }));
        await settle();
        expect(s.decide).toHaveBeenCalledWith(expect.objectContaining({ botId: 'b1', toolName: 'create_issue', serverId: 's1', fingerprint: 'fp-1', person: { signedIn: true, identifier: 'uuid-sara' }, voice: false }));
    });

    it('does not run it when the gate now refuses, and says why', async () => {
        s = setup({ verdict: { kind: 'refuse', why: 'no_permission', line: "You can't have Linear change things here." } });
        await s.approvals.propose(input());
        await s.approvals.handleTap('b1', ROOM, SARA, tap('act_1', 1, { action: 'decide', option: 'approve' }));
        await settle();
        expect(s.run).not.toHaveBeenCalled();
        expect(s.orbit.finished).toEqual([{ id: 'act_1', outcome: 'notSent' }]);
        expect(field(s.sent.at(-1)!.content).answer?.result).toBe("You can't have Linear change things here.");
        expect(s.outcomes[0].state).toBe('failed');
    });

    it('does not run it when the tool changed since the card', async () => {
        s = setup({ entry: { ...ENTRY, fingerprint: 'fp-2' } });
        await s.approvals.propose(input());
        await s.approvals.handleTap('b1', ROOM, SARA, tap('act_1', 1, { action: 'decide', option: 'approve' }));
        await settle();
        expect(s.run).not.toHaveBeenCalled();
        expect(s.orbit.finished).toEqual([{ id: 'act_1', outcome: 'notSent' }]);
        expect(field(s.sent.at(-1)!.content).answer?.result).toContain('changed');
    });

    it('does not run it when the settings changed since the card', async () => {
        s = setup({ verdict: { ...ASK, policyRevision: 5 } });
        await s.approvals.propose(input());
        await s.approvals.handleTap('b1', ROOM, SARA, tap('act_1', 1, { action: 'decide', option: 'approve' }));
        await settle();
        expect(s.run).not.toHaveBeenCalled();
        expect(field(s.sent.at(-1)!.content).answer?.result).toContain('settings changed');
    });

    it('never sends it again when it went out and got no answer, and tells the person to check', async () => {
        s = setup({ runResult: { error: 'The tool gave no answer', outcome: 'uncertain' } });
        await s.approvals.propose(input());
        await s.approvals.handleTap('b1', ROOM, SARA, tap('act_1', 1, { action: 'decide', option: 'approve' }));
        await settle();
        expect(s.run).toHaveBeenCalledTimes(1);
        expect(s.orbit.finished).toEqual([{ id: 'act_1', outcome: 'uncertain' }]);
        expect(field(s.sent.at(-1)!.content).answer).toEqual({ option: 'approve', unknown: true });
        expect(s.outcomes[0].state).toBe('unknown');
        // A second approval of the same card finds it already used
        await s.approvals.handleTap('b1', ROOM, SARA, tap('act_1', 2, { action: 'decide', option: 'approve' }));
        await settle();
        expect(s.run).toHaveBeenCalledTimes(1);
    });

    it('says when it did not work, and when it was proven not sent', async () => {
        s = setup({ runResult: { error: 'Tool error: no such team', outcome: 'failed' } });
        await s.approvals.propose(input());
        await s.approvals.handleTap('b1', ROOM, SARA, tap('act_1', 1, { action: 'decide', option: 'approve' }));
        await settle();
        expect(s.orbit.finished).toEqual([{ id: 'act_1', outcome: 'failed' }]);
        expect(field(s.sent.at(-1)!.content).answer?.result).toBe('Tool error: no such team');
        expect(s.outcomes[0]).toMatchObject({ state: 'failed', result: 'Tool error: no such team' });
    });

    it('runs an approved call that nobody started when the person taps again after a lost answer, once', async () => {
        await s.approvals.propose(input());
        const real = s.orbit.decide.bind(s.orbit);
        let first = true;
        s.orbit.decide = (async (...args: Parameters<typeof real>) => {
            const answer = await real(...args);
            if (first) {
                first = false;
                throw new Error('answer lost');
            }
            return answer;
        }) as never;
        await s.approvals.handleTap('b1', ROOM, SARA, tap('act_1', 1, { action: 'decide', option: 'approve' }));
        await settle();
        expect(s.run).not.toHaveBeenCalled();
        await s.approvals.handleTap('b1', ROOM, SARA, tap('act_1', 1, { action: 'decide', option: 'approve' }));
        await settle();
        await s.approvals.handleTap('b1', ROOM, SARA, tap('act_1', 1, { action: 'decide', option: 'approve' }));
        await settle();
        expect(s.run).toHaveBeenCalledTimes(1);
    });

    it('shows one card for the same call asked twice while it waits, such as a turn asked again', async () => {
        const first = await s.approvals.propose(input());
        const again = await s.approvals.propose(input());
        expect(first.kind).toBe('waiting');
        expect(again.kind).toBe('waiting');
        expect(s.orbit.actions.size).toBe(1);
        expect(s.sent).toHaveLength(1);
        // A different call is its own card
        await s.approvals.propose(input({ args: { team: 'IOS', title: 'x' } }));
        expect(s.orbit.actions.size).toBe(2);
    });

    it('shows one card for the same call asked twice at the very same moment', async () => {
        const [a, b] = await Promise.all([s.approvals.propose(input()), s.approvals.propose(input())]);
        expect(a.kind).toBe('waiting');
        expect(b.kind).toBe('waiting');
        expect(s.orbit.actions.size).toBe(1);
        expect(s.sent).toHaveLength(1);
    });

    it('does not run an approved, unstarted call because of a stale tap that said no', async () => {
        await s.approvals.propose(input());
        s.orbit.actions.set('act_1', { ...s.orbit.actions.get('act_1')!, status: 'approved', revision: 2 });
        await s.approvals.handleTap('b1', ROOM, SARA, tap('act_1', 1, { action: 'decide', option: 'decline' }));
        await settle();
        expect(s.run).not.toHaveBeenCalled();
    });

    it('says the tap did not count when Orbit answers a 409 that is not about the action', async () => {
        await s.approvals.propose(input());
        s.orbit.decide = (async () => ({ outcome: 'already_decided' })) as never;
        await s.approvals.handleTap('b1', ROOM, SARA, tap('act_1', 1, { action: 'decide', option: 'approve' }));
        await settle();
        expect(s.run).not.toHaveBeenCalled();
        expect(s.said.at(-1)).toContain('Tap again');
    });

    it('says nothing was done when the claim itself fails, and does not call the tool', async () => {
        await s.approvals.propose(input());
        s.orbit.claim = (async () => {
            throw new Error('timeout');
        }) as never;
        await s.approvals.handleTap('b1', ROOM, SARA, tap('act_1', 1, { action: 'decide', option: 'approve' }));
        await settle();
        expect(s.run).not.toHaveBeenCalled();
        const answer = field(s.sent.at(-1)!.content).answer!;
        expect(answer.unknown).toBeUndefined();
        expect(answer.result).toContain('nothing was done');
        expect(s.outcomes[0]).toMatchObject({ state: 'failed' });
    });

    it('shows what the action is now when the claim is lost', async () => {
        await s.approvals.propose(input());
        s.orbit.claim = (async (_bot: string, id: string) => ({ claimed: false as const, reason: 'stale', action: { ...s.orbit.actions.get(id)!, status: 'closed' as const, closedReason: 'stale' as const, revision: 5 } })) as never;
        await s.approvals.handleTap('b1', ROOM, SARA, tap('act_1', 1, { action: 'decide', option: 'approve' }));
        await settle();
        expect(s.run).not.toHaveBeenCalled();
        expect(field(s.sent.at(-1)!.content).answer).toEqual({ expired: true });
    });
});

describe('Create, and allow more (approve and remember)', () => {
    it('saves the approval for the hours set, runs the call, and the card says how long it lasts', async () => {
        await s.approvals.propose(input());
        await s.approvals.handleTap('b1', ROOM, SARA, tap('act_1', 1, { action: 'decide', option: 'approveAndRemember' }));
        await settle();
        expect(s.orbit.decisionExtra).toEqual({ idleMinutes: 60, absoluteMinutes: 480 });
        expect(s.run).toHaveBeenCalledTimes(1);
        const answer = field(s.sent.at(-1)!.content).answer!;
        expect(answer.option).toBe('approveAndRemember');
        expect(answer.allowedMore).toBe(allowedMoreLine());
        expect(answer.allowedMore).toContain('1 hour');
        expect(answer.allowedMore).toContain('8 hours');
    });

    it('is ended by Ask me again, and the next call asks', async () => {
        await s.approvals.propose(input());
        await s.approvals.handleTap('b1', ROOM, SARA, tap('act_1', 1, { action: 'decide', option: 'approveAndRemember' }));
        await settle();
        const cardRevision = s.orbit.actions.get('act_1')!.revision;
        await s.approvals.handleTap('b1', ROOM, SARA, tap('act_1', cardRevision, { action: 'askAgain' }));
        expect(s.orbit.revoked).toEqual(['ask_again']);
        expect(field(s.sent.at(-1)!.content).answer?.allowedMore).toBeUndefined();
        expect((await s.approvals.propose(input())).kind).toBe('waiting');
    });
});

describe("Don't create, X, More time", () => {
    it('does nothing when declined', async () => {
        await s.approvals.propose(input());
        await s.approvals.handleTap('b1', ROOM, SARA, tap('act_1', 1, { action: 'decide', option: 'decline' }));
        await settle();
        expect(s.run).not.toHaveBeenCalled();
        expect(field(s.sent.at(-1)!.content).answer).toEqual({ option: 'decline' });
        expect(s.outcomes).toHaveLength(0);
    });

    it('closes the card with X and does nothing', async () => {
        await s.approvals.propose(input());
        await s.approvals.handleTap('b1', ROOM, SARA, tap('act_1', 1, { action: 'close' }));
        expect(s.run).not.toHaveBeenCalled();
        expect(s.orbit.actions.get('act_1')).toMatchObject({ status: 'closed', closedReason: 'cancelled' });
        expect(field(s.sent.at(-1)!.content).answer).toEqual({ closed: true });
    });

    it('gives the card another wait and redraws it at its new end, without answering it', async () => {
        await s.approvals.propose(input());
        await s.approvals.handleTap('b1', ROOM, SARA, tap('act_1', 1, { action: 'moreTime' }));
        const card = field(s.sent.at(-1)!.content);
        expect(card.revision).toBe(2);
        expect(card.expiresAt).toBe(Date.parse('2026-11-04T12:20:00.000Z'));
        expect(card.answer).toBeUndefined();
        expect(s.run).not.toHaveBeenCalled();
    });

    it('says so when a card can not wait any longer', async () => {
        await s.approvals.propose(input());
        s.orbit.extensions = 10;
        await s.approvals.handleTap('b1', ROOM, SARA, tap('act_1', 1, { action: 'moreTime' }));
        expect(s.said[0]).toContain('cannot wait any longer');
    });

    it('shows what won when a tap lost to another one (a second device)', async () => {
        await s.approvals.propose(input());
        await s.approvals.handleTap('b1', ROOM, SARA, tap('act_1', 1, { action: 'decide', option: 'decline' }));
        await s.approvals.handleTap('b1', ROOM, SARA, tap('act_1', 1, { action: 'decide', option: 'approve' }));
        await settle();
        expect(s.run).not.toHaveBeenCalled();
        expect(field(s.sent.at(-1)!.content).answer).toEqual({ option: 'decline' });
    });
});

describe('Review again', () => {
    it('makes a fresh card from the saved call after the checks pass again', async () => {
        await s.approvals.propose(input());
        await s.approvals.handleTap('b1', ROOM, SARA, tap('act_1', 1, { action: 'close' }));
        await s.approvals.handleTap('b1', ROOM, SARA, tap('act_1', 2, { action: 'reviewAgain' }));
        expect(s.orbit.actions.get('act_2')).toMatchObject({ status: 'waiting', arguments: ARGS, toolFingerprint: 'fp-1' });
        expect(field(s.sent.at(-1)!.content)).toMatchObject({ id: 'act_2', revision: 1 });
        expect(s.run).not.toHaveBeenCalled();
    });

    it('still shows a card when a remembered approval now covers the call, so the tap is never silent', async () => {
        await s.approvals.propose(input());
        await s.approvals.handleTap('b1', ROOM, SARA, tap('act_1', 1, { action: 'close' }));
        s.orbit.grants.push({ id: 'g1', toolName: 'create_issue', fixed: { team: 'WEB' } });
        await s.approvals.handleTap('b1', ROOM, SARA, tap('act_1', 2, { action: 'reviewAgain' }));
        expect(s.orbit.actions.get('act_2')).toMatchObject({ status: 'waiting' });
        expect(s.run).not.toHaveBeenCalled();
    });

    it('does not bring back a call the person declined', async () => {
        await s.approvals.propose(input());
        await s.approvals.handleTap('b1', ROOM, SARA, tap('act_1', 1, { action: 'decide', option: 'decline' }));
        await s.approvals.handleTap('b1', ROOM, SARA, tap('act_1', 2, { action: 'reviewAgain' }));
        expect(s.orbit.actions.has('act_2')).toBe(false);
    });

    it('says why when the tool changed or the person may not any more, instead of a card', async () => {
        await s.approvals.propose(input());
        await s.approvals.handleTap('b1', ROOM, SARA, tap('act_1', 1, { action: 'close' }));
        s.decide.mockResolvedValue({ kind: 'refuse', why: 'off', line: 'Create issue is turned off for this bot.' });
        await s.approvals.handleTap('b1', ROOM, SARA, tap('act_1', 2, { action: 'reviewAgain' }));
        expect(s.said).toEqual(['Create issue is turned off for this bot.']);
        expect(s.orbit.actions.has('act_2')).toBe(false);
    });
});

describe('typing something else', () => {
    it('closes the cards still waiting for that person, and nothing is done', async () => {
        await s.approvals.propose(input());
        await s.approvals.propose(input({ args: { team: 'IOS', title: 'x' } }));
        await s.approvals.onPersonMessage('b1', ROOM, SARA);
        expect(s.run).not.toHaveBeenCalled();
        expect(s.orbit.actions.get('act_1')!.closedReason).toBe('superseded');
        expect(s.orbit.actions.get('act_2')!.closedReason).toBe('superseded');
        const ended = s.sent.slice(2).map((s2) => field(s2.content));
        expect(ended.map((card) => card.answer)).toEqual([{ typed: true }, { typed: true }]);
    });

    it('keeps their remembered approvals alive', async () => {
        await s.approvals.onPersonMessage('b1', ROOM, SARA);
        expect(s.orbit.touched).toBe(1);
    });

    it('still has Orbit close their waiting cards when this server no longer holds them (after a restart)', async () => {
        await s.approvals.propose(input());
        const restarted = setup();
        restarted.orbit.actions = s.orbit.actions;
        await restarted.approvals.onPersonMessage('b1', ROOM, SARA);
        expect(s.orbit.actions.get('act_1')!.closedReason).toBe('superseded');
    });

    it("leaves another person's cards and other chats alone", async () => {
        await s.approvals.propose(input());
        await s.approvals.onPersonMessage('b1', ROOM, { uuid: 'uuid-other' });
        await s.approvals.onPersonMessage('b1', '!other:matrix.test', SARA);
        expect(s.orbit.actions.get('act_1')!.status).toBe('waiting');
    });
});

describe('whose tap counts', () => {
    it("ignores a tap from someone who did not ask, or in another chat", async () => {
        await s.approvals.propose(input());
        await s.approvals.handleTap('b1', ROOM, { uuid: 'uuid-other' }, tap('act_1', 1, { action: 'decide', option: 'approve' }));
        await s.approvals.handleTap('b1', '!other:matrix.test', SARA, tap('act_1', 1, { action: 'decide', option: 'approve' }));
        await settle();
        expect(s.run).not.toHaveBeenCalled();
        expect(s.orbit.actions.get('act_1')!.status).toBe('waiting');
    });

    it('tells the person when their answer could not be recorded', async () => {
        await s.approvals.propose(input());
        s.orbit.down = true;
        await s.approvals.handleTap('b1', ROOM, SARA, tap('act_1', 1, { action: 'decide', option: 'approve' }));
        expect(s.said[0]).toContain("couldn't record");
        expect(s.run).not.toHaveBeenCalled();
    });

    it('takes a tap on a card from before a restart from what Orbit saved, and shows the ended card as a new notice', async () => {
        await s.approvals.propose(input());
        const fresh = setup();
        fresh.orbit.actions = s.orbit.actions;
        fresh.orbit.nextId = 2;
        await fresh.approvals.handleTap('b1', ROOM, SARA, tap('act_1', 1, { action: 'decide', option: 'approve' }));
        await settle();
        expect(fresh.run).toHaveBeenCalledTimes(1);
        expect(fresh.sent[0].content['m.relates_to']).toBeUndefined();
        expect(field(fresh.sent[0].content).answer?.result).toBe('Created WEB-12');
    });

    it("ignores a tap on someone else's saved action after a restart", async () => {
        await s.approvals.propose(input());
        const fresh = setup();
        fresh.orbit.actions = s.orbit.actions;
        await fresh.approvals.handleTap('b1', ROOM, { uuid: 'uuid-other' }, tap('act_1', 1, { action: 'decide', option: 'approve' }));
        expect(fresh.run).not.toHaveBeenCalled();
    });
});

describe('answerFor', () => {
    const closed = (closedReason: SavedAction['closedReason']): SavedAction => ({ id: 'a', status: 'closed', closedReason } as SavedAction);
    it('reads how an action that is past waiting ended', () => {
        expect(answerFor(closed('declined'))).toEqual({ option: 'decline' });
        expect(answerFor(closed('cancelled'))).toEqual({ closed: true });
        expect(answerFor(closed('superseded'))).toEqual({ typed: true });
        expect(answerFor(closed('expired'))).toEqual({ expired: true });
        expect(answerFor(closed('stale'))).toEqual({ expired: true });
        expect(answerFor({ status: 'couldntConfirm' } as SavedAction)).toEqual({ option: 'approve', unknown: true });
        expect(answerFor({ status: 'done' } as SavedAction)).toEqual({ option: 'approve' });
    });
});
