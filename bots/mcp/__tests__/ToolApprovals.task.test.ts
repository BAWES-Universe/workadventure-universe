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
import { BotRegistry } from '../../server/BotRegistry';

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
    cancelled: string[] = [];
    cancelFails = false;
    async cancel(_bot: string, id: string) {
        if (this.cancelFails) throw new Error('Orbit is down');
        this.cancelled.push(id);
        this.actions.set(id, { ...this.actions.get(id)!, status: 'closed', closedReason: 'cancelled' } as SavedAction);
    }
    async touchGrants() {}
    async revokeGrants() {}
}

function make(orbit: FakeOrbit, sent: Array<{ content: Record<string, any> }>, run = vi.fn(async () => [{ type: 'text', text: 'Created WEB-12' }]), checked: GateDecision = RUN, theirs?: () => boolean, more: Partial<ConstructorParameters<typeof ToolApprovals>[0]> = {}) {
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
        ...(theirs ? { roomStillTheirs: theirs } : {}),
        ...more,
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

describe('a goal’s card and who is in the room', () => {
    it('is shown while the chat is still only theirs', async () => {
        const theirs = vi.fn(() => true);
        const proposed = await make(orbit, sent, undefined, RUN, theirs).propose(input());
        expect(proposed.kind).toBe('waiting');
        expect(theirs).toHaveBeenCalledWith('b1', ROOM, '@sara:matrix.test');
        expect(sent).toHaveLength(1);
    });

    it('is not sent when someone joined the chat meanwhile, and the saved step is closed so no tap finds it', async () => {
        const proposed = await make(orbit, sent, undefined, RUN, () => false).propose(input());
        expect(proposed.kind).toBe('failed');
        expect(sent).toHaveLength(0);
        expect(orbit.cancelled).toEqual(['act_1']);
        expect(orbit.actions.get('act_1')!.status).toBe('closed');
    });

    it('shows its card on the next ask when it could not be shown and could not be closed, and does not join a card nobody has', async () => {
        orbit.cancelFails = true;
        let theirs = false;
        const approvals = make(orbit, sent, undefined, RUN, () => theirs);
        expect((await approvals.propose(input())).kind).toBe('failed');
        expect(sent).toHaveLength(0);
        expect(orbit.actions.get('act_1')!.status).toBe('waiting');
        // The chat is theirs again: the same step is that saved step, now with its card
        theirs = true;
        expect((await approvals.propose(input())).kind).toBe('waiting');
        expect(sent).toHaveLength(1);
        expect(orbit.actions.size).toBe(1);
        // And now that a card is shown, asking again joins it
        const again = await approvals.propose(input());
        expect((again as unknown as { result: { message: string } }).result.message).toMatch(/already asked/);
        expect(sent).toHaveLength(1);
    });
});

describe('a goal’s card tapped from a room it was not sent to', () => {
    const tap = { ask: 'act_1', revision: 1, tap: { action: 'decide', option: 'approve' } as never };
    const OTHER_ROOM = '!elsewhere:matrix.test';

    it('is not run, and not drawn there, after a restart: only the person’s own direct chat counts', async () => {
        await make(orbit, sent).propose(input());
        const runs = vi.fn(async () => [{ type: 'text', text: 'Created WEB-12' }]);
        const directRoomIs = vi.fn(async (_bot: string, room: string) => room === ROOM);
        const restarted = make(orbit, sent, runs, RUN, undefined, { directRoomIs });
        const shown = sent.length;
        await restarted.handleTap('b1', OTHER_ROOM, SARA, tap);
        await settle();
        expect(runs).not.toHaveBeenCalled();
        expect(sent).toHaveLength(shown);
        expect(orbit.actions.get('act_1')!.status).toBe('waiting');
        // From her own chat, the same tap counts
        await restarted.handleTap('b1', ROOM, SARA, tap);
        await settle();
        expect(runs).toHaveBeenCalledTimes(1);
    });

    it('is not believed when the chat the tap came from cannot be told, or the tap names no chat user', async () => {
        await make(orbit, sent).propose(input());
        const runs = vi.fn(async () => [{ type: 'text', text: 'Created WEB-12' }]);
        const broken = make(orbit, sent, runs, RUN, undefined, {
            directRoomIs: async () => {
                throw new Error('chat down');
            },
        });
        await broken.handleTap('b1', ROOM, SARA, tap);
        const noUser = make(orbit, sent, runs, RUN, undefined, { directRoomIs: async () => true });
        await noUser.handleTap('b1', ROOM, { uuid: SARA.uuid }, tap);
        await settle();
        expect(runs).not.toHaveBeenCalled();
    });
});

describe('a goal’s card that could not be shown, remembered for every bot server', () => {
    function sharedStore() {
        const marked = new Set<string>();
        return {
            marked,
            store: {
                mark: async (id: string) => void marked.add(id),
                marked: async (id: string) => marked.has(id),
                clear: async (id: string) => void marked.delete(id),
            },
        };
    }

    it('is shown by another server, or after a restart, instead of joining a card nobody has', async () => {
        orbit.cancelFails = true;
        const { marked, store } = sharedStore();
        let theirs = false;
        const first = make(orbit, sent, undefined, RUN, () => theirs, { unshownCards: store });
        expect((await first.propose(input())).kind).toBe('failed');
        expect(marked.has('act_1')).toBe(true);
        // Another runner, which never saw the failure, asks for the same step once the chat is theirs again
        theirs = true;
        const other = make(orbit, sent, undefined, RUN, () => theirs, { unshownCards: store });
        expect((await other.propose(input())).kind).toBe('waiting');
        expect(sent).toHaveLength(1);
        expect(marked.has('act_1')).toBe(false);
        // Now that a card is shown, it joins that card
        const later = make(orbit, sent, undefined, RUN, () => theirs, { unshownCards: store });
        const again = await later.propose(input());
        expect((again as unknown as { result: { message: string } }).result.message).toMatch(/already asked/);
        expect(sent).toHaveLength(1);
    });

    it('is shown again by the server that failed, not twice, once another server has shown it', async () => {
        orbit.cancelFails = true;
        const { store } = sharedStore();
        let theirs = false;
        const first = make(orbit, sent, undefined, RUN, () => theirs, { unshownCards: store });
        expect((await first.propose(input())).kind).toBe('failed');
        // Another bot server shows the card and clears the shared note
        theirs = true;
        expect((await make(orbit, sent, undefined, RUN, () => theirs, { unshownCards: store }).propose(input())).kind).toBe('waiting');
        expect(sent).toHaveLength(1);
        // The first server asks for the same step again: its own old note must not send a second card
        const again = await first.propose(input());
        expect((again as unknown as { result: { message: string } }).result.message).toMatch(/already asked/);
        expect(sent).toHaveLength(1);
    });

    it('still believes its own note when it could not be written to the shared store', async () => {
        orbit.cancelFails = true;
        const marked = new Set<string>();
        let writable = false;
        const store = {
            mark: async (id: string) => {
                if (!writable) throw new Error('down');
                marked.add(id);
            },
            marked: async (id: string) => marked.has(id),
            clear: async (id: string) => void marked.delete(id),
        };
        let theirs = false;
        const first = make(orbit, sent, undefined, RUN, () => theirs, { unshownCards: store });
        expect((await first.propose(input())).kind).toBe('failed');
        // The store is back, but it never heard of the failure: this server still knows the step has no card, and shows it
        writable = true;
        theirs = true;
        expect((await first.propose(input())).kind).toBe('waiting');
        expect(sent).toHaveLength(1);
    });

    it('keeps its own note when the shared store is not connected, as the production adapter says (it never counts as written)', async () => {
        orbit.cancelFails = true;
        // The registry's own behaviour with no Redis: mark and read refuse, they do not quietly answer
        const registry = new BotRegistry('test') as any;
        registry.redis = undefined;
        const store = { mark: (id: string) => registry.markTaskCardUnshown(id), marked: (id: string) => registry.taskCardUnshown(id), clear: (id: string) => registry.clearTaskCardUnshown(id) };
        let theirs = false;
        const approvals = make(orbit, sent, undefined, RUN, () => theirs, { unshownCards: store });
        expect((await approvals.propose(input())).kind).toBe('failed');
        // Asked again with the chat theirs: the step has no card, so the card is shown, not joined as "already asked"
        theirs = true;
        expect((await approvals.propose(input())).kind).toBe('waiting');
        expect(sent).toHaveLength(1);
    });

    it('does not take a card that was shown for a missing one when the store was down while its marker was cleared', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        try {
            orbit.cancelFails = true;
            const { marked, store } = sharedStore();
            // The first server cannot show the card: the marker is written. Another server shows it, but cannot clear the marker (the store drops out)
            let theirs = false;
            const first = make(orbit, sent, undefined, RUN, () => theirs, { unshownCards: store });
            expect((await first.propose(input())).kind).toBe('failed');
            expect(marked.has('act_1')).toBe(true);
            theirs = true;
            let clearing = false;
            const failing = { ...store, clear: async (id: string) => (clearing ? store.clear(id) : Promise.reject(new Error('down'))) };
            const other = make(orbit, sent, undefined, RUN, () => theirs, { unshownCards: failing });
            expect((await other.propose(input())).kind).toBe('waiting');
            expect(sent).toHaveLength(1);
            expect(marked.has('act_1')).toBe(true);
            // The step is asked again by a server that does not hold the card, while the marker is still in the store: it knows nothing of the stale marker,
            // so what protects the card is that the server that showed it clears the marker as soon as the store is back
            clearing = true;
            await vi.advanceTimersByTimeAsync(30_000);
            expect(marked.has('act_1')).toBe(false);
            // Now the same step asked by another server joins the card instead of showing a second one
            const third = make(orbit, sent, undefined, RUN, () => theirs, { unshownCards: store });
            const again = await third.propose(input());
            expect((again as unknown as { result: { message: string } }).result.message).toMatch(/already asked/);
            expect(sent).toHaveLength(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('holds a shown card at once, so a tap made while the shared note is being cleared is not undone', async () => {
        const { store } = sharedStore();
        let release: () => void = () => undefined;
        const slow = { ...store, clear: (id: string) => new Promise<void>((resolve) => (release = () => resolve(void store.clear(id)))) };
        orbit.cancelFails = true;
        const approvals = make(orbit, sent, undefined, RUN, () => true, { unshownCards: slow });
        // A saved step that has no card yet: it is shown now, and the shared note is cleared slowly
        expect((await make(orbit, sent, undefined, RUN, () => false, { unshownCards: store }).propose(input())).kind).toBe('failed');
        orbit.cancelFails = false;
        const proposing = approvals.propose(input());
        for (let i = 0; i < 20 && sent.length < 1; i++) await settle();
        expect(sent).toHaveLength(1);
        // The person taps the visible card before the note is cleared
        await approvals.handleTap('b1', ROOM, SARA, { ask: 'act_1', revision: 1, tap: { action: 'decide', option: 'approve' } as never });
        release();
        await proposing;
        await settle();
        expect((approvals as unknown as { cards: Map<string, { waiting: boolean }> }).cards.get('act_1')?.waiting).toBe(false);
    });

    it('does not fail a goal’s ask when the shared store cannot be read or written', async () => {
        const down = {
            mark: async () => {
                throw new Error('down');
            },
            marked: async () => {
                throw new Error('down');
            },
            clear: async () => {
                throw new Error('down');
            },
        };
        const approvals = make(orbit, sent, undefined, RUN, undefined, { unshownCards: down });
        expect((await approvals.propose(input())).kind).toBe('waiting');
        expect((await make(orbit, sent, undefined, RUN, undefined, { unshownCards: down }).propose(input())).kind).toBe('waiting');
        expect(sent).toHaveLength(1);
    });
});
