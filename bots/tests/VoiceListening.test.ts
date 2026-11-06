/**
 * A bot's daily listening limit (#1859): what a voice bot hears of group chatter is counted in Orbit, and once the day's minutes are
 * used it stops taking group microphones until the next day. It still answers typed lines and still speaks, and a person alone with
 * it can still talk. These tests check the counting, and what the relay does with Orbit's answer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ListeningBudget, type ListeningOrbit } from '../voice/VoiceListening';
import { VoiceCalls, type GameSide, type LinkHandlers } from '../voice/VoiceCalls';
import type { FromWorker, ToWorker } from '../voice/protocol';
import type { VoiceLink } from '../voice/VoiceLink';

const SPACE = 'proximity-1';
const BOT = 'room_9';
const DAY_END = '2026-11-07T00:00:00.000Z';
const NOON = Date.parse('2026-11-06T12:00:00.000Z');

type Answer = Awaited<ReturnType<ListeningOrbit['reportVoiceListening']>>;
const answer = (spent: boolean, usedSeconds = 0, limitSeconds = 60): Answer => ({ spent, usedSeconds, limitSeconds, resetsAt: DAY_END });

/** A clock the test moves, and an Orbit whose answers it scripts. */
function budget(replies: Answer[] = [answer(false)]) {
    let now = NOON;
    const queue = [...replies];
    const orbit = { reportVoiceListening: vi.fn(async (_botId: string, _input: { seconds: number }) => (queue.length > 1 ? queue.shift()! : queue[0])) };
    const changes = vi.fn();
    const logs: string[] = [];
    const b = new ListeningBudget('bot-1', orbit, changes, (m) => logs.push(m), () => now);
    return { b, orbit, changes, logs, queue, advance: (ms: number) => (now += ms), set: (replies2: Answer[]) => (queue.length = 0, queue.push(...replies2)) };
}

beforeEach(() => vi.useFakeTimers({ now: NOON }));
afterEach(() => vi.useRealTimers());

describe('the budget: counting', () => {
    it('reports what gathers in one call, after a short wait', async () => {
        const t = budget();
        t.b.add(3000);
        t.b.add(4000);
        expect(t.orbit.reportVoiceListening).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(10_000);
        expect(t.orbit.reportVoiceListening).toHaveBeenCalledTimes(1);
        expect(t.orbit.reportVoiceListening).toHaveBeenCalledWith('bot-1', { seconds: 7 });
    });

    it('reports at once when a lot has gathered', async () => {
        const t = budget();
        t.b.add(16_000);
        await vi.advanceTimersByTimeAsync(0);
        expect(t.orbit.reportVoiceListening).toHaveBeenCalledWith('bot-1', { seconds: 16 });
    });

    it('keeps a part of a second until more comes', async () => {
        const t = budget();
        t.b.add(1600);
        await t.b.flush();
        expect(t.orbit.reportVoiceListening).toHaveBeenLastCalledWith('bot-1', { seconds: 1 });
        t.b.add(500);
        await t.b.flush();
        expect(t.orbit.reportVoiceListening).toHaveBeenLastCalledWith('bot-1', { seconds: 1 });
    });

    it('ignores nothing and nonsense', async () => {
        const t = budget();
        t.b.add(0);
        t.b.add(-5);
        t.b.add(Number.NaN);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(t.orbit.reportVoiceListening).not.toHaveBeenCalled();
    });

    it('keeps what it could not report, and keeps listening', async () => {
        const t = budget([null]);
        t.b.add(5000);
        await t.b.flush();
        expect(t.b.isSpent()).toBe(false);
        expect(t.logs).toHaveLength(1);
        t.set([answer(false)]);
        await t.b.flush();
        expect(t.orbit.reportVoiceListening).toHaveBeenLastCalledWith('bot-1', { seconds: 5 });
    });

    it('does not retry in a loop when a lot has gathered and Orbit cannot be asked: one try, then a wait that grows', async () => {
        const t = budget([null]);
        t.b.add(20_000);
        await vi.advanceTimersByTimeAsync(0);
        expect(t.orbit.reportVoiceListening).toHaveBeenCalledTimes(1);
        // More chatter during the wait does not make it try again before the wait is over
        t.advance(5_000);
        t.b.add(20_000);
        await vi.advanceTimersByTimeAsync(5_000);
        expect(t.orbit.reportVoiceListening).toHaveBeenCalledTimes(1);
        // After 30 s it tries again; failing again, the next wait is twice as long
        t.advance(25_000);
        await vi.advanceTimersByTimeAsync(25_000);
        expect(t.orbit.reportVoiceListening).toHaveBeenCalledTimes(2);
        t.advance(59_000);
        await vi.advanceTimersByTimeAsync(59_000);
        expect(t.orbit.reportVoiceListening).toHaveBeenCalledTimes(2);
        t.advance(1_000);
        await vi.advanceTimersByTimeAsync(1_000);
        expect(t.orbit.reportVoiceListening).toHaveBeenCalledTimes(3);
        // And it reports what it kept once Orbit answers
        t.set([answer(false)]);
        t.advance(120_000);
        await vi.advanceTimersByTimeAsync(120_000);
        expect(t.orbit.reportVoiceListening).toHaveBeenCalledTimes(4);
        expect(t.orbit.reportVoiceListening).toHaveBeenLastCalledWith('bot-1', { seconds: 40 });
    });

    it('reports what gathered while a report was out, after the usual wait', async () => {
        const t = budget();
        let release!: () => void;
        t.orbit.reportVoiceListening.mockImplementationOnce(async () => {
            await new Promise<void>((resolve) => (release = resolve));
            return answer(false);
        });
        t.b.add(16_000);
        await vi.advanceTimersByTimeAsync(0);
        // Some chatter arrives while that report is out, and a look at the day comes with it
        t.b.add(4_000);
        void t.b.flush();
        release();
        await vi.advanceTimersByTimeAsync(0);
        expect(t.orbit.reportVoiceListening).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(10_000);
        expect(t.orbit.reportVoiceListening).toHaveBeenCalledTimes(2);
        expect(t.orbit.reportVoiceListening).toHaveBeenLastCalledWith('bot-1', { seconds: 4 });
    });

    it('stops reporting once the bot is shut down', async () => {
        const t = budget();
        t.b.add(5_000);
        t.b.shutdown();
        await vi.advanceTimersByTimeAsync(60_000);
        t.b.add(20_000);
        await t.b.flush();
        expect(t.orbit.reportVoiceListening).not.toHaveBeenCalled();
    });

    it('never throws when Orbit does', async () => {
        const t = budget();
        t.orbit.reportVoiceListening.mockRejectedValueOnce(new Error('down'));
        t.b.add(5000);
        await expect(t.b.flush()).resolves.toBeUndefined();
        expect(t.b.isSpent()).toBe(false);
    });
});

describe('the budget: a spent day', () => {
    it('is spent until the next day when Orbit says the minutes are used, and says so once', async () => {
        const t = budget([answer(true, 61)]);
        t.b.add(61_000);
        await t.b.flush();
        expect(t.b.isSpent()).toBe(true);
        expect(t.changes).toHaveBeenCalledTimes(1);
        await t.b.flush();
        expect(t.changes).toHaveBeenCalledTimes(1);
    });

    it('listens again by itself when the next day starts', async () => {
        const t = budget([answer(true, 61)]);
        await t.b.flush();
        expect(t.b.isSpent()).toBe(true);
        t.changes.mockClear();
        t.advance(12 * 3600_000);
        await vi.advanceTimersByTimeAsync(12 * 3600_000);
        expect(t.b.isSpent()).toBe(false);
        expect(t.changes).toHaveBeenCalledTimes(1);
    });

    it('listens again when the limit is raised in Orbit, at the next look', async () => {
        const t = budget([answer(true, 61)]);
        await t.b.flush();
        t.changes.mockClear();
        t.set([answer(false, 61, 120)]);
        t.advance(61_000);
        await t.b.check();
        expect(t.b.isSpent()).toBe(false);
        expect(t.changes).toHaveBeenCalledTimes(1);
    });

    it('looks at most once a minute when only a part of a second is waiting to be reported', async () => {
        const t = budget();
        t.b.add(1600);
        await t.b.flush();
        expect(t.orbit.reportVoiceListening).toHaveBeenCalledTimes(1);
        // 600 ms is left over: it is not a reason to ask again every time a group changes
        await t.b.check();
        await t.b.check();
        expect(t.orbit.reportVoiceListening).toHaveBeenCalledTimes(1);
    });

    it('looks at most once a minute when only asking', async () => {
        const t = budget();
        await t.b.check();
        await t.b.check();
        expect(t.orbit.reportVoiceListening).toHaveBeenCalledTimes(1);
        expect(t.orbit.reportVoiceListening).toHaveBeenCalledWith('bot-1', { seconds: 0 });
        t.advance(61_000);
        await t.b.check();
        expect(t.orbit.reportVoiceListening).toHaveBeenCalledTimes(2);
    });
});

// ---- what the relay does with it ----

function relay() {
    const sent: ToWorker[] = [];
    let handlers!: LinkHandlers;
    const link: VoiceLink = { isUp: () => true, send: (m) => (sent.push(m), true), close: vi.fn() };
    const game: GameSide = {
        botSpaceUserId: (space) => (space === SPACE ? BOT : undefined),
        sendSignal: () => undefined,
        sendDisconnect: () => undefined,
        sendStart: () => undefined,
        sendDraft: () => undefined,
        sendStatus: () => undefined,
    };
    const orbit = { reportVoiceListening: vi.fn(async (_botId: string, _input: { seconds: number }): Promise<Answer> => answer(false)) };
    let calls!: VoiceCalls;
    const listening = new ListeningBudget('bot-1', orbit, () => calls.listeningChanged());
    calls = new VoiceCalls('bot-1', game, (h) => ((handlers = h), link), undefined, undefined, undefined, listening);
    const person = (id: string) => ({ spaceUserId: id, uuid: `uuid-${id}`, tags: [], name: id }) as never;
    const start = (who: string) =>
        calls.handlePrivateEvent({
            spaceName: SPACE,
            receiverUserId: BOT,
            sender: { spaceUserId: who, uuid: `uuid-${who}`, tags: [], name: who },
            spaceEvent: { event: { $case: 'webRtcStartMessage', webRtcStartMessage: { userId: who, initiator: false } } },
        } as never);
    const modeSets = () => sent.filter((m) => m.type === 'mode.set') as Extract<ToWorker, { type: 'mode.set' }>[];
    const turn = (who: string, text: string | undefined, audioMs: number, outcome: 'final' | 'cleared' | 'lost' = 'final') => {
        const lane = [...sent].reverse().find((m) => m.type === 'lane.open' && m.participantId === who) as Extract<ToWorker, { type: 'lane.open' }>;
        handlers.onMessage({ type: 'user.turn', sessionId: lane.sessionId, participantId: who, epoch: lane.epoch, turnId: '1-1', outcome, text, audioMs } as FromWorker);
    };
    /** The group: two people in the bubble, both connected. */
    const group = async () => {
        calls.spaceUsers(SPACE, [person('room_7'), person('room_8')]);
        start('room_7');
        start('room_8');
        await vi.advanceTimersByTimeAsync(0);
    };
    return { calls, sent, orbit, listening, person, start, modeSets, turn, group };
}

describe('the relay: counting group chatter', () => {
    it('counts the audio of a turn in a group that was not said to the bot, and not what was', async () => {
        const t = relay();
        await t.group();
        t.orbit.reportVoiceListening.mockClear();
        t.calls.hears = (_space, _person, text) => /^nora\b/i.test(text);
        t.turn('room_7', 'Nora, what time is it', 4000);
        t.turn('room_7', 'Sara, lunch at one?', 5000);
        await t.listening.flush();
        expect(t.orbit.reportVoiceListening).toHaveBeenCalledWith('bot-1', { seconds: 5 });
    });

    it('counts sound in a group with no words, but not words that were lost (they may have been for the bot)', async () => {
        const t = relay();
        await t.group();
        t.orbit.reportVoiceListening.mockClear();
        t.turn('room_7', undefined, 3000, 'cleared');
        t.turn('room_7', 'some words', 9000, 'lost');
        await t.listening.flush();
        expect(t.orbit.reportVoiceListening).toHaveBeenCalledWith('bot-1', { seconds: 3 });
    });

    it('counts nothing for a person alone with the bot: everything they say is for it', async () => {
        const t = relay();
        t.calls.spaceUsers(SPACE, [t.person('room_7')]);
        t.start('room_7');
        await vi.advanceTimersByTimeAsync(0);
        t.orbit.reportVoiceListening.mockClear();
        t.turn('room_7', undefined, 3000, 'cleared');
        t.turn('room_7', 'hello', 3000);
        await t.listening.flush();
        expect(t.orbit.reportVoiceListening).toHaveBeenCalledWith('bot-1', { seconds: 0 });
    });
});

describe('the relay: a spent day', () => {
    const spend = async (t: ReturnType<typeof relay>) => {
        t.orbit.reportVoiceListening.mockResolvedValue(answer(true, 61));
        t.calls.hears = () => false;
        t.turn('room_7', 'chatter', 61_000);
        await vi.advanceTimersByTimeAsync(0);
    };

    it('stops taking the microphones of a group: talking becomes typing, so the bot still speaks its answers', async () => {
        const t = relay();
        await t.group();
        await spend(t);
        const sets = t.modeSets();
        expect(sets.map((m) => [m.participantId, m.mode]).sort()).toEqual([['room_7', 'type_and_listen'], ['room_8', 'type_and_listen']]);
    });

    it('leaves a person who chose text only, or listening, as they chose', async () => {
        const t = relay();
        t.calls.spaceUsers(SPACE, [t.person('room_7'), t.person('room_8')]);
        t.calls.handlePrivateEvent({ spaceName: SPACE, receiverUserId: BOT, sender: { spaceUserId: 'room_8', uuid: 'u8', tags: [], name: 'p' }, spaceEvent: { event: { $case: 'voiceModeChoice', voiceModeChoice: { mode: 'off' } } } } as never);
        t.start('room_7');
        t.start('room_8');
        await vi.advanceTimersByTimeAsync(0);
        const before = t.sent.length;
        await spend(t);
        expect(t.modeSets().filter((m) => t.sent.indexOf(m) >= before).map((m) => [m.participantId, m.mode])).toEqual([['room_7', 'type_and_listen']]);
    });

    it('takes speaking and reading to text only', async () => {
        const t = relay();
        t.calls.spaceUsers(SPACE, [t.person('room_7'), t.person('room_8')]);
        t.calls.handlePrivateEvent({ spaceName: SPACE, receiverUserId: BOT, sender: { spaceUserId: 'room_7', uuid: 'u7', tags: [], name: 'p' }, spaceEvent: { event: { $case: 'voiceModeChoice', voiceModeChoice: { mode: 'speak_and_read' } } } } as never);
        t.start('room_7');
        t.start('room_8');
        await vi.advanceTimersByTimeAsync(0);
        await spend(t);
        expect(t.modeSets().find((m) => m.participantId === 'room_7')).toMatchObject({ mode: 'off' });
    });

    it('never holds back a person alone with the bot, and listens to them again the moment they are alone', async () => {
        const t = relay();
        await t.group();
        await spend(t);
        t.sent.length = 0;
        // The other person leaves: room_7 is alone with the bot, so their microphone is theirs again
        t.calls.spaceUserLeft(SPACE, 'room_8');
        expect(t.modeSets().map((m) => [m.participantId, m.mode])).toEqual([['room_7', 'talk']]);
        // A new connection of someone alone opens as they chose
        t.start('room_7');
        expect(t.sent.find((m) => m.type === 'lane.open')).toMatchObject({ mode: 'talk' });
    });

    it('holds a group back again when it forms, and opens a new connection in a group as typing', async () => {
        const t = relay();
        t.calls.spaceUsers(SPACE, [t.person('room_7')]);
        t.start('room_7');
        await vi.advanceTimersByTimeAsync(0);
        t.calls.spaceUserJoined(SPACE, t.person('room_8'));
        await spend(t);
        t.sent.length = 0;
        t.start('room_8');
        expect(t.sent.find((m) => m.type === 'lane.open' && m.participantId === 'room_8')).toMatchObject({ mode: 'type_and_listen' });
    });

    it('tells a LiveKit room each person\'s mode with the hold applied', async () => {
        const t = relay();
        t.calls.spaceUsers(SPACE, [t.person('room_7'), t.person('room_8')]);
        t.calls.handlePrivateEvent({ spaceName: SPACE, receiverUserId: BOT, sender: { spaceUserId: BOT, uuid: 'bot-1', tags: ['bot'], name: 'bot' }, spaceEvent: { event: { $case: 'livekitInvitationMessage', livekitInvitationMessage: { token: 'jwt', serverUrl: 'wss://livekit.example' } } } } as never);
        await vi.advanceTimersByTimeAsync(0);
        t.sent.length = 0;
        t.orbit.reportVoiceListening.mockResolvedValue(answer(true, 61));
        await t.listening.flush();
        const people = t.sent.filter((m) => m.type === 'room.people').pop() as Extract<ToWorker, { type: 'room.people' }>;
        expect(people.people.map((p) => p.mode)).toEqual(['type_and_listen', 'type_and_listen']);
    });

    it('takes the microphones again when the next day starts', async () => {
        const t = relay();
        await t.group();
        await spend(t);
        t.sent.length = 0;
        await vi.advanceTimersByTimeAsync(13 * 3600_000);
        expect(t.modeSets().map((m) => [m.participantId, m.mode]).sort()).toEqual([['room_7', 'talk'], ['room_8', 'talk']]);
    });

    it('asks Orbit where the day stands when a group forms, so a day already used is known before anyone talks', async () => {
        const t = relay();
        t.orbit.reportVoiceListening.mockResolvedValue(answer(true, 3600, 3600));
        await t.group();
        await vi.advanceTimersByTimeAsync(0);
        expect(t.orbit.reportVoiceListening).toHaveBeenCalledWith('bot-1', { seconds: 0 });
        expect(t.modeSets().map((m) => m.mode)).toEqual(['type_and_listen', 'type_and_listen']);
    });

    it('does nothing at all for a bot with no listening budget', async () => {
        const sent: ToWorker[] = [];
        const link: VoiceLink = { isUp: () => true, send: (m) => (sent.push(m), true), close: vi.fn() };
        const game = { botSpaceUserId: () => BOT, sendSignal: () => undefined, sendDisconnect: () => undefined, sendStart: () => undefined, sendDraft: () => undefined, sendStatus: () => undefined } as GameSide;
        const calls = new VoiceCalls('bot-1', game, () => link);
        calls.spaceUsers(SPACE, [{ spaceUserId: 'room_7', uuid: 'u', tags: [], name: 'a' } as never, { spaceUserId: 'room_8', uuid: 'u2', tags: [], name: 'b' } as never]);
        expect(sent.filter((m) => m.type === 'mode.set')).toEqual([]);
        calls.listeningChanged();
        expect(sent.filter((m) => m.type === 'mode.set')).toEqual([]);
    });
});
