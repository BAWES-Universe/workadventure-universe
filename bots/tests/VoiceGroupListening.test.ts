/**
 * Listening in a group (round 8): with two or more people in the bubble, the bot takes a person's microphone only after they asked it to
 * keep listening, for this visit. The worker confirms each change, and the person is told only what is confirmed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrivateEventPusherToFront } from '@workadventure/messages';
import { LISTEN_CONFIRM_MS, VoiceCalls, type GameSide, type LinkHandlers } from '../voice/VoiceCalls';
import type { FromWorker, ListenInfo, ToWorker, VoiceStatus } from '../voice/protocol';
import type { VoiceLink } from '../voice/VoiceLink';

const SPACE = 'proximity-1';
const BOT = 'room_9';

type ModeSet = Extract<ToWorker, { type: 'mode.set' }>;

function setup(gate = true) {
    const sent: ToWorker[] = [];
    const told: { to: string; status: VoiceStatus; listen?: ListenInfo }[] = [];
    let handlers!: LinkHandlers;
    const link: VoiceLink = { isUp: () => true, send: (m) => (sent.push(m), true), close: vi.fn() };
    const game: GameSide = {
        botSpaceUserId: (space) => (space === SPACE ? BOT : undefined),
        sendSignal: () => undefined,
        sendDisconnect: () => undefined,
        sendStart: () => undefined,
        sendDraft: () => undefined,
        sendStatus: (_space, to, status, _left, listen) => told.push({ to, status, listen }),
    };
    const calls = new VoiceCalls('bot-1', game, (h) => ((handlers = h), link));
    calls.groupGate = gate;
    const granted: [string, string][] = [];
    calls.onListenGranted = (space, person) => granted.push([space, person]);
    const person = (id: string) => ({ spaceUserId: id, uuid: `uuid-${id}`, tags: [], name: id }) as never;
    const fromPerson = (who: string, event: object): PrivateEventPusherToFront =>
        ({ spaceName: SPACE, receiverUserId: BOT, sender: { spaceUserId: who, uuid: `uuid-${who}`, tags: [], name: who }, spaceEvent: { event } }) as never;
    const start = (who: string) => calls.handlePrivateEvent(fromPerson(who, { $case: 'webRtcStartMessage', webRtcStartMessage: { userId: who, initiator: false } }));
    const choose = (who: string, mode: string, listen = '') => calls.handlePrivateEvent(fromPerson(who, { $case: 'voiceModeChoice', voiceModeChoice: { mode, listen } }));
    const lane = (who: string) => [...sent].reverse().find((m) => m.type === 'lane.open' && m.participantId === who) as Extract<ToWorker, { type: 'lane.open' }>;
    const connected = (who: string) => {
        const l = lane(who);
        handlers.onMessage({ type: 'participant.join', sessionId: l.sessionId, participantId: who, epoch: l.epoch });
    };
    const modeSets = (who?: string) => (sent.filter((m) => m.type === 'mode.set') as ModeSet[]).filter((m) => !who || m.participantId === who);
    const lastRequest = (who: string) => modeSets(who).filter((m) => m.requestId).pop()!;
    const ack = (who: string, overrides: Partial<Extract<FromWorker, { type: 'mode.ack' }>> = {}) => {
        const request = lastRequest(who);
        const l = lane(who);
        handlers.onMessage({ type: 'mode.ack', sessionId: request.sessionId, participantId: who, requestId: request.requestId!, mode: request.mode, path: 'lane', epoch: l.epoch, ...overrides });
    };
    const listenOf = (who: string) => [...told].reverse().find((t) => t.to === who)?.listen ?? { state: '', reason: '' };
    /** Alice alone with the bot and heard hands-free, then Bob joins. */
    const aliceThenBob = () => {
        calls.spaceUsers(SPACE, [person('alice')]);
        start('alice');
        connected('alice');
        calls.spaceUserJoined(SPACE, person('bob'));
        start('bob');
        connected('bob');
    };
    return { calls, sent, told, granted, person, start, choose, connected, modeSets, lastRequest, ack, listenOf, aliceThenBob, onMessage: (m: FromWorker) => handlers.onMessage(m) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('listening in a group: the group rule', () => {
    it('hears someone alone hands-free, as before, and says nothing about listening', () => {
        const t = setup();
        t.calls.spaceUsers(SPACE, [t.person('alice')]);
        t.start('alice');
        t.connected('alice');
        expect(t.sent.find((m) => m.type === 'lane.open')).toMatchObject({ mode: 'talk' });
        expect(t.modeSets()).toEqual([]);
        expect(t.listenOf('alice')).toEqual({ state: '', reason: '' });
    });

    it('stops taking the microphone of someone it heard alone when a friend joins, and tells them why', () => {
        const t = setup();
        t.aliceThenBob();
        expect(t.modeSets('alice').map((m) => m.mode)).toEqual(['type_and_listen']);
        expect(t.listenOf('alice')).toEqual({ state: 'off', reason: 'others_joined' });
        // Bob arrived into a group: his connection opens without the microphone, and nothing was lost for him
        expect(t.sent.find((m) => m.type === 'lane.open' && m.participantId === 'bob')).toMatchObject({ mode: 'type_and_listen' });
        expect(t.listenOf('bob')).toEqual({ state: 'off', reason: '' });
    });

    it('takes speaking and reading to text only in a group, and leaves typing modes alone', () => {
        const t = setup();
        t.calls.spaceUsers(SPACE, [t.person('alice'), t.person('bob')]);
        t.choose('alice', 'speak_and_read');
        t.choose('bob', 'type_and_listen');
        t.start('alice');
        t.start('bob');
        t.connected('bob');
        expect(t.sent.find((m) => m.type === 'lane.open' && m.participantId === 'alice')).toMatchObject({ mode: 'off' });
        expect(t.sent.find((m) => m.type === 'lane.open' && m.participantId === 'bob')).toMatchObject({ mode: 'type_and_listen' });
        expect(t.listenOf('bob')).toEqual({ state: '', reason: '' });
    });

    it('changes nothing without the group rule turned on', () => {
        const t = setup(false);
        t.aliceThenBob();
        expect(t.modeSets()).toEqual([]);
        expect(t.told.every((m) => m.listen === undefined)).toBe(true);
    });

    it('hears someone hands-free again the moment they are alone', () => {
        const t = setup();
        t.aliceThenBob();
        t.calls.spaceUserLeft(SPACE, 'bob');
        expect(t.modeSets('alice').map((m) => m.mode)).toEqual(['type_and_listen', 'talk']);
        expect(t.listenOf('alice')).toEqual({ state: '', reason: '' });
    });
});

describe('listening in a group: keep talking', () => {
    it('takes the microphone once the worker confirms, then opens one fresh follow-up', () => {
        const t = setup();
        t.aliceThenBob();
        t.choose('alice', 'talk', 'keep');
        const request = t.lastRequest('alice');
        expect(request).toMatchObject({ mode: 'talk', participantId: 'alice' });
        expect(t.listenOf('alice')).toEqual({ state: 'pending', reason: '' });
        expect(t.granted).toEqual([]);
        t.ack('alice');
        expect(t.listenOf('alice')).toEqual({ state: 'on', reason: '' });
        expect(t.granted).toEqual([[SPACE, 'alice']]);
        // The same confirmation again opens nothing more
        t.ack('alice');
        expect(t.granted).toHaveLength(1);
    });

    it('ignores a confirmation of an older ask, or of a path that has been replaced', () => {
        const t = setup();
        t.aliceThenBob();
        t.choose('alice', 'talk', 'keep');
        const first = t.lastRequest('alice');
        t.choose('alice', 'talk', 'keep');
        t.ack('alice', { requestId: first.requestId });
        expect(t.listenOf('alice').state).toBe('pending');
        t.ack('alice', { epoch: 999 });
        expect(t.listenOf('alice').state).toBe('pending');
        expect(t.calls.stats.staleFromWorker).toBe(2);
        t.ack('alice');
        expect(t.listenOf('alice').state).toBe('on');
    });

    it('keeps the ask for the whole visit: another arrival changes nothing', () => {
        const t = setup();
        t.aliceThenBob();
        t.choose('alice', 'talk', 'keep');
        t.ack('alice');
        const before = t.modeSets('alice').length;
        t.calls.spaceUserJoined(SPACE, t.person('carol'));
        expect(t.modeSets('alice')).toHaveLength(before);
        expect(t.listenOf('alice')).toEqual({ state: 'on', reason: '' });
    });

    it('does not keep an ask the worker never confirms, and says it could not start', async () => {
        const t = setup();
        t.aliceThenBob();
        t.choose('alice', 'talk', 'keep');
        await vi.advanceTimersByTimeAsync(LISTEN_CONFIRM_MS);
        expect(t.listenOf('alice')).toEqual({ state: 'off', reason: 'failed' });
        // The microphone is put back to untaken, in case the worker took it late
        expect(t.modeSets('alice').pop()).toMatchObject({ mode: 'type_and_listen' });
        expect(t.granted).toEqual([]);
        // A confirmation after that opens nothing
        t.ack('alice');
        expect(t.granted).toEqual([]);
    });

    it('ends with the visit: leaving and coming back starts again without the ask', () => {
        const t = setup();
        t.aliceThenBob();
        t.choose('alice', 'talk', 'keep');
        t.ack('alice');
        t.calls.spaceUserLeft(SPACE, 'alice');
        t.calls.spaceUserJoined(SPACE, t.person('alice'));
        t.start('alice');
        expect(t.sent.filter((m) => m.type === 'lane.open' && m.participantId === 'alice').pop()).toMatchObject({ mode: 'type_and_listen' });
    });

    it('closes live input when the person chooses a mode without the microphone, and never makes an ask by choosing talk again', () => {
        const t = setup();
        t.aliceThenBob();
        t.choose('alice', 'talk', 'keep');
        t.ack('alice');
        t.choose('alice', 'type_and_listen');
        expect(t.listenOf('alice')).toEqual({ state: '', reason: '' });
        t.choose('alice', 'talk');
        expect(t.modeSets('alice').pop()).toMatchObject({ mode: 'type_and_listen' });
        expect(t.listenOf('alice')).toEqual({ state: 'off', reason: '' });
    });

    it('keeps the ask between talk and speak and read', () => {
        const t = setup();
        t.aliceThenBob();
        t.choose('alice', 'talk', 'keep');
        t.ack('alice');
        t.choose('alice', 'speak_and_read');
        expect(t.modeSets('alice').pop()).toMatchObject({ mode: 'speak_and_read' });
        expect(t.listenOf('alice').state).toBe('on');
    });

    it('does nothing for someone alone: the bot already hears them', () => {
        const t = setup();
        t.calls.spaceUsers(SPACE, [t.person('alice')]);
        t.start('alice');
        t.connected('alice');
        t.choose('alice', 'talk', 'keep');
        expect(t.modeSets().filter((m) => m.requestId)).toEqual([]);
        expect(t.granted).toEqual([]);
    });

    it('refuses an ask it does not know', () => {
        const t = setup();
        t.aliceThenBob();
        t.choose('alice', 'talk', 'always');
        expect(t.calls.stats.rejectedFromGame).toBe(1);
        expect(t.listenOf('alice').state).toBe('off');
    });
});

describe('listening in a group: stop listening', () => {
    it('stops at once, and says it is off only when the worker confirms', () => {
        const t = setup();
        t.aliceThenBob();
        t.choose('alice', 'talk', 'keep');
        t.ack('alice');
        t.choose('alice', 'talk', 'stop');
        expect(t.lastRequest('alice')).toMatchObject({ mode: 'type_and_listen' });
        expect(t.listenOf('alice')).toEqual({ state: 'stopping', reason: '' });
        t.ack('alice');
        expect(t.listenOf('alice')).toEqual({ state: 'off', reason: '' });
        expect(t.granted).toHaveLength(1);
    });

    it('says it may still hear them when the stop is not confirmed in time, and asks the worker again', async () => {
        const t = setup();
        t.aliceThenBob();
        t.choose('alice', 'talk', 'keep');
        t.ack('alice');
        t.choose('alice', 'talk', 'stop');
        const asked = t.modeSets('alice').length;
        await vi.advanceTimersByTimeAsync(LISTEN_CONFIRM_MS);
        expect(t.listenOf('alice')).toEqual({ state: 'checking', reason: '' });
        expect(t.modeSets('alice')).toHaveLength(asked + 1);
        t.ack('alice');
        expect(t.listenOf('alice')).toEqual({ state: 'off', reason: '' });
    });

    it('cancels while turning on', () => {
        const t = setup();
        t.aliceThenBob();
        t.choose('alice', 'talk', 'keep');
        t.choose('alice', 'talk', 'stop');
        t.ack('alice');
        expect(t.listenOf('alice')).toEqual({ state: 'off', reason: '' });
        expect(t.granted).toEqual([]);
    });
});

describe('listening in a group: LiveKit', () => {
    it('names the person with their mode in the room, and takes a room confirmation', () => {
        const t = setup();
        t.calls.spaceUsers(SPACE, [t.person('alice'), t.person('bob')]);
        t.calls.handlePrivateEvent({
            spaceName: SPACE,
            receiverUserId: BOT,
            sender: { spaceUserId: BOT, uuid: 'bot-1', tags: ['bot'], name: 'bot' },
            spaceEvent: { event: { $case: 'livekitInvitationMessage', livekitInvitationMessage: { token: 'jwt', serverUrl: 'wss://livekit.example' } } },
        } as never);
        const join = t.sent.find((m) => m.type === 'room.join') as Extract<ToWorker, { type: 'room.join' }>;
        t.onMessage({ type: 'room.state', sessionId: join.sessionId, epoch: join.epoch, state: 'connected' });
        const peopleBefore = t.sent.filter((m) => m.type === 'room.people').pop() as Extract<ToWorker, { type: 'room.people' }>;
        expect(peopleBefore.people.map((p) => p.mode)).toEqual(['type_and_listen', 'type_and_listen']);
        t.choose('alice', 'talk', 'keep');
        const people = t.sent.filter((m) => m.type === 'room.people').pop() as Extract<ToWorker, { type: 'room.people' }>;
        expect(people.people.find((p) => p.participantId === 'alice')).toMatchObject({ mode: 'talk' });
        const request = t.lastRequest('alice');
        // A lane confirmation is not this room's
        t.onMessage({ type: 'mode.ack', sessionId: request.sessionId, participantId: 'alice', requestId: request.requestId!, mode: 'talk', path: 'lane', epoch: join.epoch });
        expect(t.listenOf('alice').state).toBe('pending');
        t.onMessage({ type: 'mode.ack', sessionId: request.sessionId, participantId: 'alice', requestId: request.requestId!, mode: 'talk', path: 'room', epoch: join.epoch });
        expect(t.listenOf('alice')).toEqual({ state: 'on', reason: '' });
        expect(t.granted).toEqual([[SPACE, 'alice']]);
    });
});
