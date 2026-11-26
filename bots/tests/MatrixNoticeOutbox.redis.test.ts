import { randomUUID } from 'crypto';
import { createClient } from 'redis';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createMatrixAppServiceRouter, type MatrixEvent, type MatrixEventHandler } from '../matrix/MatrixAppServiceRouter';
import { MatrixDmBridge } from '../matrix/MatrixDmBridge';
import { BOT_STATUS_KEY } from '../matrix/BotStatusNotes';
import { createEventInbox, INBOX_KEY, type EventInbox, type InboxEntry } from '../matrix/MatrixEventInbox';
import { takeTurnOnInbox } from './helpers/sharedInboxLock';

/**
 * GPT's eighth note, G (Opus's design of 24 Nov, patch 2): the notice about a message that will not be handled ("Cut off" after paid work began, "couldn't answer" otherwise) got ONE
 * delivery attempt. A failed send left the person in silence exactly where nobody can say whether work or a charge happened. Now the closure writes the notice to a durable outbox in the
 * same store step, and it is sent under one Matrix transaction id until Matrix gives it an event id. On a real Redis, through the real router, inbox and DM bridge; Matrix is a fake that
 * behaves as Synapse does for `PUT /send/{type}/{txnId}` (one event per transaction id while it remembers the transaction).
 */
const URL = process.env.BOTS_TEST_REDIS_URL;
describe.runIf(!!URL)('the outbox of the notices to people whose message will not be handled (GPT eighth note G; a real Redis)', () => {
    const client = createClient({ url: URL });
    const used: string[] = [];
    const rooms: string[] = [];
    const servers: Server[] = [];
    const config = { homeserverUrl: 'http://hs', domain: 'matrix.test', asToken: 'as-secret', hsToken: 'hs-secret' };
    let giveTurnBack: (() => Promise<void>) | undefined;
    const cleanups: Array<() => unknown> = [];
    const entries: InboxEntry[] = [];
    beforeAll(async () => {
        await client.connect();
        giveTurnBack = await takeTurnOnInbox(client as never);
    }, 330_000);
    afterEach(async () => {
        for (const cleanup of cleanups.splice(0).reverse()) await Promise.resolve(cleanup()).catch(() => undefined);
        await Promise.all(entries.splice(0).map((entry) => entry.done().catch(() => undefined)));
        vi.restoreAllMocks();
        const keys = await client.keys('matrix:*');
        const mine = keys.filter((key) => used.some((id) => key.endsWith(id)) || rooms.some((room) => key.endsWith(room)));
        if (mine.length > 0) await client.del(mine);
        for (const id of used) await client.zRem(INBOX_KEY, id);
        for (const id of used) await client.zRem('matrix:outbox', id);
        used.length = 0;
        rooms.length = 0;
    });
    afterAll(async () => {
        await Promise.all(servers.map((one) => new Promise<void>((resolve) => one.close(() => resolve()))));
        await giveTurnBack?.();
        await client.quit();
    });

    const fresh = (what = 'ev') => {
        const id = `$${what}-${randomUUID()}`;
        used.push(id);
        return id;
    };
    const roomOf = (what = 'room') => {
        const room = `!${what}-${randomUUID()}:matrix.test`;
        rooms.push(room);
        return room;
    };
    const say = (room: string, id: string, body: string): MatrixEvent => ({ type: 'm.room.message', room_id: room, sender: '@alice:matrix.test', event_id: id, origin_server_ts: Date.now(), content: { msgtype: 'm.text', body } });
    const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const quiet = () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    };
    const stateOf = (id: string) => client.get(`matrix:event:${id}`);
    /** Short waits for the tests: a failed send is due again after 50 ms (then 100 ms). */
    const inboxOn = (extra: Parameters<typeof createEventInbox>[1] = {}): EventInbox => {
        const inbox = createEventInbox(() => client as never, { ttlSeconds: 60, beatEveryMs: 60_000, staleMs: 60, noticeRetryMs: 50, noticeRetryMaxMs: 100, ...extra });
        return {
            ...inbox,
            take: async (eventId, event) => {
                const taken = await inbox.take(eventId, event);
                if (taken && taken !== 'busy') entries.push(taken);
                return taken;
            },
            recover: async () => {
                const found = await inbox.recover();
                for (const one of found) entries.push(one.entry);
                return found;
            },
        };
    };
    const serve = async (inbox: EventInbox, handler: Pick<MatrixEventHandler, 'onEvent'> & Partial<MatrixEventHandler>) => {
        const router = createMatrixAppServiceRouter(config, { userExists: async () => true, ...handler }, { inbox, waitCheckMs: 50 });
        cleanups.push(() => router.settle(500));
        const app = express();
        app.use(router);
        const server = await new Promise<Server>((resolve) => {
            const s = app.listen(0, () => resolve(s));
        });
        servers.push(server);
        const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        const put = (txn: string, ...events: MatrixEvent[]) =>
            fetch(`${base}/_matrix/app/v1/transactions/${txn}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer hs-secret' }, body: JSON.stringify({ events }) });
        return { router, put };
    };

    /**
     * Matrix, as Synapse answers `PUT /rooms/{room}/send/m.room.message/{txnId}`: one event per transaction id while it remembers the transaction (`forget` is a homeserver restart, or a
     * transaction older than its memory). `next` says what the next sends do: `fail` (refused, nothing in the room), `lose` (the event is in the room, the answer never comes back).
     */
    const fakeMatrix = () => {
        const events: Array<{ event_id: string; room_id: string; sender: string; type: string; content: Record<string, any>; txnId: string }> = [];
        const remembered = new Map<string, string>();
        const next: Array<'fail' | 'lose'> = [];
        let count = 0;
        const sendMessage = vi.fn(async (user: string, room: string, content: Record<string, any>, txnId: string = randomUUID()) => {
            const how = next.shift();
            if (how === 'fail') throw new Error('Matrix is not answering');
            const key = `${user}|${txnId}`;
            let id = remembered.get(key);
            if (!id) {
                id = `$notice-${++count}`;
                remembered.set(key, id);
                events.push({ event_id: id, room_id: room, sender: user, type: 'm.room.message', content, txnId });
            }
            if (how === 'lose') throw new Error('socket hang up');
            return id;
        });
        // `/messages` read backwards: the latest `limit` events of the room that pass the filter, oldest first
        const getRecentMessages = vi.fn(async (_user: string, room: string, limit = 20, filter?: { types?: string[]; senders?: string[] }) =>
            events
                .filter((one) => one.room_id === room && (!filter?.senders || filter.senders.includes(one.sender)) && (!filter?.types || filter.types.includes(one.type)))
                .slice(-limit)
                .map(({ txnId: _t, ...event }) => event)
        );
        /** Someone else writes in the room (not through the Brick). */
        const write = (room: string, sender: string, body: string) => events.push({ event_id: `$other-${++count}`, room_id: room, sender, type: 'm.room.message', content: { msgtype: 'm.text', body }, txnId: randomUUID() });
        return { events, next, sendMessage, getRecentMessages, write, forget: () => remembered.clear() };
    };
    const botId = '0b7c1d2e-1111-4222-8333-944455556666';
    const botUser = `@bot_${botId}:matrix.test`;
    /** A bot server: the real DM bridge over the fake Matrix. `reply` is the paid model turn: it must never run for a notice. */
    const bridgeOn = (room: string, matrix: ReturnType<typeof fakeMatrix>, reply: () => Promise<unknown> = async () => ({ text: 'Paused.', media: [] })) => {
        const deps: any = {
            getBotConfig: vi.fn(async () => ({ botId, name: 'Guide', enabled: true, aiProviderRef: 'p' })),
            checkAccess: vi.fn(async () => ({ allowed: true, reason: null, user: { uuid: 'uuid-alice', name: 'Alice', isGuest: false } })),
            reply: vi.fn(reply),
            rooms: { rememberDmRoom: vi.fn(async () => undefined), getDmRoomBot: vi.fn(async (r: string) => (r === room ? botId : null)), forgetDmRoom: vi.fn(async () => undefined) },
        };
        const matrixClient: any = {
            ensureRegistered: vi.fn(async () => undefined),
            setDisplayName: vi.fn(async () => undefined),
            getDisplayName: vi.fn(async () => 'Guide'),
            joinRoom: vi.fn(async () => undefined),
            leaveRoom: vi.fn(async () => undefined),
            sendText: vi.fn(async () => `$reply-${randomUUID()}`),
            sendMessage: matrix.sendMessage,
            setTyping: vi.fn(async () => undefined),
            getJoinedMembers: vi.fn(async () => ['@alice:matrix.test', botUser]),
            getRecentMessages: matrix.getRecentMessages,
        };
        const bridge = new MatrixDmBridge(config, matrixClient as never, deps);
        return { bridge, deps, handler: { onEvent: (event: MatrixEvent, hooks?: any) => bridge.onEvent(event, hooks), onGaveUp: (event: MatrixEvent, why: any, delivery?: any) => bridge.onGaveUp(event, why, delivery) } };
    };
    const notes = (matrix: ReturnType<typeof fakeMatrix>, room: string, state?: string) =>
        matrix.events.filter((one) => one.room_id === room && one.content?.[BOT_STATUS_KEY] && (state === undefined || one.content[BOT_STATUS_KEY].state === state));
    /** An entry whose server began paid work and then went away: admitted, marked paid, never finished, never beating again. */
    const paidAndGone = async (room: string, id: string) => {
        const dead = inboxOn({ owner: 'dies' });
        const entry = (await dead.take(id, say(room, id, 'Pause the job'))) as InboxEntry;
        await entry.admit();
        await entry.paid();
        await pause(150);
        return entry;
    };

    it('GPT\'s trace: the "Cut off" notice of a paid turn fails once; the entry reaches its terminal unanswered state; a redelivery through a fresh router handles nothing; the notice still gets out, once, with no paid call', async () => {
        quiet();
        const room = roomOf('cutoff');
        const id = fresh('cutoff');
        await paidAndGone(room, id);
        const matrix = fakeMatrix();
        // the first send is refused (Matrix down for a moment)
        matrix.next.push('fail');
        const B = bridgeOn(room, matrix);
        const b = await serve(inboxOn(), B.handler);
        expect(await b.router.recover()).toBe(0);
        await vi.waitFor(() => expect(matrix.sendMessage).toHaveBeenCalledTimes(1));
        // the work record is closed as unanswered, and the notice is NOT closed with it: it waits in the outbox, with no expiry
        await vi.waitFor(async () => expect(await stateOf(id)).toBe('u'));
        expect(notes(matrix, room)).toHaveLength(0);
        await vi.waitFor(async () => expect(await client.hGet(`matrix:outbox:${id}`, 'why')).toBe('paid'));
        expect(await client.ttl(`matrix:outbox:${id}`)).toBe(-1);
        // Synapse sends the transaction again to a fresh router: the closed entry is not handled again
        const C = bridgeOn(room, matrix);
        const c = await serve(inboxOn(), C.handler);
        expect((await c.put(`t-${randomUUID()}`, say(room, id, 'Pause the job'))).status).toBe(200);
        await pause(150);
        // the next look sends the notice: one "Cut off" note in the room
        await c.router.recover();
        await vi.waitFor(() => expect(notes(matrix, room, 'unsure')).toHaveLength(1));
        expect(notes(matrix, room)[0].content[BOT_STATUS_KEY].title).toBe('Cut off');
        expect(notes(matrix, room, 'trouble')).toHaveLength(0);
        // it leaves the outbox only now, and the receipt is the event id Matrix gave it
        await vi.waitFor(async () => expect(await client.exists(`matrix:outbox:${id}`)).toBe(0));
        expect(await client.get(`matrix:outbox-sent:${id}`)).toBe(notes(matrix, room)[0].event_id);
        // zero paid calls anywhere, and nothing more is said
        expect(B.deps.reply).not.toHaveBeenCalled();
        expect(C.deps.reply).not.toHaveBeenCalled();
        await pause(150);
        await b.router.recover();
        await c.router.recover();
        await pause(100);
        expect(notes(matrix, room)).toHaveLength(1);
    });

    it('an ordinary DM that ran out of tries: its "couldn\'t answer" note fails twice, and the recovery scan sends it: one event, zero paid calls', async () => {
        quiet();
        const room = roomOf('tries');
        const id = fresh('tries');
        const matrix = fakeMatrix();
        matrix.next.push('fail', 'fail');
        const B = bridgeOn(room, matrix);
        // the handler fails before anything paid begins, on its only try
        const b = await serve(inboxOn({ maxTries: 1 }), {
            onEvent: async () => {
                throw new Error('fails before anything is paid for');
            },
            onGaveUp: B.handler.onGaveUp,
        });
        expect((await b.put(`t-${randomUUID()}`, say(room, id, 'Hello?'))).status).toBe(200);
        await vi.waitFor(() => expect(matrix.sendMessage).toHaveBeenCalledTimes(1));
        await vi.waitFor(async () => expect(await stateOf(id)).toBe('d'));
        expect(notes(matrix, room)).toHaveLength(0);
        await pause(80);
        await b.router.recover();
        await vi.waitFor(() => expect(matrix.sendMessage).toHaveBeenCalledTimes(2));
        expect(notes(matrix, room)).toHaveLength(0);
        await pause(150);
        await b.router.recover();
        await vi.waitFor(() => expect(notes(matrix, room, 'trouble')).toHaveLength(1));
        // every send used the one transaction id
        expect(new Set(matrix.sendMessage.mock.calls.map((call) => call[3])).size).toBe(1);
        await vi.waitFor(async () => expect(await client.exists(`matrix:outbox:${id}`)).toBe(0));
        expect(B.deps.reply).not.toHaveBeenCalled();
    });

    it('an uncertain send (Matrix took the note, the answer was lost), then a restart: one event in the room and the same event id, whether Matrix still remembers the transaction or not', async () => {
        quiet();
        for (const forgets of [false, true]) {
            const room = roomOf(forgets ? 'forgot' : 'remembers');
            const id = fresh(forgets ? 'forgot' : 'remembers');
            await paidAndGone(room, id);
            const matrix = fakeMatrix();
            matrix.next.push('lose');
            const B = bridgeOn(room, matrix);
            const b = await serve(inboxOn(), B.handler);
            await b.router.recover();
            await vi.waitFor(() => expect(matrix.sendMessage).toHaveBeenCalledTimes(1));
            // the note IS in the room, but nobody here knows it: it stays in the outbox
            expect(notes(matrix, room)).toHaveLength(1);
            await vi.waitFor(async () => expect(await client.hGet(`matrix:outbox:${id}`, 'tries')).toBe('1'));
            await b.router.settle(500);
            // the server restarts (and, the second time, the homeserver no longer remembers the transaction)
            if (forgets) matrix.forget();
            await pause(80);
            const C = bridgeOn(room, matrix);
            const c = await serve(inboxOn(), C.handler);
            await c.router.recover();
            await vi.waitFor(async () => expect(await client.exists(`matrix:outbox:${id}`)).toBe(0));
            expect(notes(matrix, room)).toHaveLength(1);
            expect(await client.get(`matrix:outbox-sent:${id}`)).toBe(notes(matrix, room)[0].event_id);
            expect(B.deps.reply).not.toHaveBeenCalled();
            expect(C.deps.reply).not.toHaveBeenCalled();
        }
    });

    it('Opus on 341f2ecd, F1: after an uncertain send the homeserver restarts (forgets the transaction) and the room cannot be read once: nothing is sent blind, and the person gets ONE note', async () => {
        quiet();
        const room = roomOf('unread');
        const id = fresh('unread');
        await paidAndGone(room, id);
        const matrix = fakeMatrix();
        matrix.next.push('lose');
        const B = bridgeOn(room, matrix);
        const b = await serve(inboxOn(), B.handler);
        await b.router.recover();
        await vi.waitFor(() => expect(matrix.sendMessage).toHaveBeenCalledTimes(1));
        expect(notes(matrix, room)).toHaveLength(1);
        await vi.waitFor(async () => expect(await client.hGet(`matrix:outbox:${id}`, 'tries')).toBe('1'));
        await b.router.settle(500);
        // the homeserver restarts: it forgets the transaction, and the first read of the room fails
        matrix.forget();
        matrix.getRecentMessages.mockRejectedValueOnce(new Error('502 Bad Gateway'));
        await pause(80);
        const C = bridgeOn(room, matrix);
        const c = await serve(inboxOn(), C.handler);
        await c.router.recover();
        await vi.waitFor(async () => expect(await client.hGet(`matrix:outbox:${id}`, 'tries')).toBe('2'));
        await pause(30);
        // nothing was sent on the try that could not look first, and the notice is still kept
        expect(matrix.sendMessage).toHaveBeenCalledTimes(1);
        expect(await client.exists(`matrix:outbox:${id}`)).toBe(1);
        // after the back-off the room can be read: the note is found there, never sent again
        await pause(150);
        await c.router.recover();
        await vi.waitFor(async () => expect(await client.exists(`matrix:outbox:${id}`)).toBe(0));
        expect(notes(matrix, room)).toHaveLength(1);
        expect(matrix.sendMessage).toHaveBeenCalledTimes(1);
        expect(await client.get(`matrix:outbox-sent:${id}`)).toBe(notes(matrix, room)[0].event_id);
    });

    it('Opus on 341f2ecd, F2: the look in the room counts only the Brick\'s own messages, so a busy room (60 of the person\'s messages since) still finds the note', async () => {
        quiet();
        const room = roomOf('busy');
        const id = fresh('busy');
        await paidAndGone(room, id);
        const matrix = fakeMatrix();
        matrix.next.push('lose');
        const B = bridgeOn(room, matrix);
        const b = await serve(inboxOn(), B.handler);
        await b.router.recover();
        await vi.waitFor(async () => expect(await client.hGet(`matrix:outbox:${id}`, 'tries')).toBe('1'));
        await b.router.settle(500);
        matrix.forget();
        for (let n = 0; n < 60; n++) matrix.write(room, '@alice:matrix.test', `message ${n}`);
        await pause(80);
        const C = bridgeOn(room, matrix);
        const c = await serve(inboxOn(), C.handler);
        await c.router.recover();
        await vi.waitFor(async () => expect(await client.exists(`matrix:outbox:${id}`)).toBe(0));
        expect(notes(matrix, room)).toHaveLength(1);
        expect(matrix.getRecentMessages).toHaveBeenCalledWith(botUser, room, 50, { types: ['m.room.message'], senders: [botUser] });
    });

    it('closing or finishing the work record never deletes the notice: it stays, with no expiry, until Matrix gives it an event id', async () => {
        quiet();
        const room = roomOf('stays');
        const id = fresh('stays');
        await paidAndGone(room, id);
        const matrix = fakeMatrix();
        matrix.next.push('fail', 'fail', 'fail');
        const B = bridgeOn(room, matrix);
        const b = await serve(inboxOn(), B.handler);
        await b.router.recover();
        await vi.waitFor(async () => expect(await stateOf(id)).toBe('u'));
        // the work record lapses entirely (its unanswered life is over): the notice is still there
        await client.del([`matrix:event:${id}`, `matrix:inbox:${id}`]);
        for (let tries = 1; tries <= 3; tries++) {
            await vi.waitFor(async () => expect(await client.hGet(`matrix:outbox:${id}`, 'tries')).toBe(String(tries)));
            expect(await client.ttl(`matrix:outbox:${id}`)).toBe(-1);
            await pause(150);
            await b.router.recover();
        }
        await vi.waitFor(() => expect(notes(matrix, room, 'unsure')).toHaveLength(1));
        await vi.waitFor(async () => expect(await client.exists(`matrix:outbox:${id}`)).toBe(0));
    });

    it('two servers looking at once send a due notice once (one holds it while it sends)', async () => {
        quiet();
        const room = roomOf('two');
        const id = fresh('two');
        await paidAndGone(room, id);
        const matrix = fakeMatrix();
        matrix.next.push('fail');
        let release!: () => void;
        const held = new Promise<void>((resolve) => (release = resolve));
        const B = bridgeOn(room, matrix);
        const b = await serve(inboxOn(), B.handler);
        await b.router.recover();
        await vi.waitFor(async () => expect(await client.hGet(`matrix:outbox:${id}`, 'tries')).toBe('1'));
        await pause(80);
        // both look while the first send of the retry is still out
        const slow = vi.fn(async (event: MatrixEvent, why: any, delivery?: any) => {
            await held;
            return B.bridge.onGaveUp(event, why, delivery);
        });
        const one = await serve(inboxOn(), { onEvent: async () => undefined, onGaveUp: slow });
        const two = await serve(inboxOn(), { onEvent: async () => undefined, onGaveUp: slow });
        await Promise.all([one.router.recover(), two.router.recover()]);
        await pause(50);
        release();
        await vi.waitFor(async () => expect(await client.exists(`matrix:outbox:${id}`)).toBe(0));
        expect(slow).toHaveBeenCalledTimes(1);
        expect(notes(matrix, room)).toHaveLength(1);
    });

    it('a notice that is still not out after the overdue time is reported once, and stays', async () => {
        quiet();
        const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const room = roomOf('overdue');
        const id = fresh('overdue');
        await paidAndGone(room, id);
        const matrix = fakeMatrix();
        matrix.next.push('fail', 'fail', 'fail');
        const B = bridgeOn(room, matrix);
        const b = await serve(inboxOn({ noticeOverdueMs: 0 }), B.handler);
        await b.router.recover();
        for (let tries = 2; tries <= 3; tries++) {
            await pause(150);
            await b.router.recover();
            await vi.waitFor(async () => expect(await client.hGet(`matrix:outbox:${id}`, 'tries')).toBe(String(tries)));
        }
        await pause(20);
        const overdue = errors.mock.calls.filter((call) => String(call[0]).includes('still not out'));
        expect(overdue).toHaveLength(1);
        expect(await client.hGet(`matrix:outbox:${id}`, 'reported')).toBe('1');
        expect(await client.exists(`matrix:outbox:${id}`)).toBe(1);
    });

    it('every closure that tells the person writes its notice in the same store step (give-back, gate, scan); a proved answer writes none', async () => {
        quiet();
        const room = roomOf('closures');
        const why = (id: string) => client.hGet(`matrix:outbox:${id}`, 'why');
        // the last give-back (RELEASE): tries
        const released = fresh('released');
        const one = (await inboxOn({ maxTries: 1 }).take(released, say(room, released, 'a'))) as InboxEntry;
        await one.admit();
        expect(await one.release()).toBe('closed');
        expect(await why(released)).toBe('tries');
        // the gate (TURN) closes one taken in too long ago: stale
        const late = fresh('late');
        const gated = (await inboxOn({ unfinishedMaxMs: -1000 }).take(late, say(roomOf('gate'), late, 'b'))) as InboxEntry;
        await gated.admit();
        expect(await gated.turn!()).toBe('stale');
        expect(await why(late)).toBe('stale');
        expect(await client.zScore('matrix:outbox', late)).not.toBeNull();
        // the scan (TAKEOVER): paid, tries, stale and a lapsed state (lost); a proved answer closes quietly and writes nothing
        const [paid, spent, lost, answered] = [fresh('paid'), fresh('spent'), fresh('lost'), fresh('answered')];
        const dead = inboxOn({ owner: 'dies', maxTries: 1 });
        for (const id of [paid, spent, lost, answered]) {
            const entry = (await dead.take(id, say(roomOf(id.slice(1, 6)), id, 'c'))) as InboxEntry;
            await entry.admit();
            if (id === paid || id === answered) await entry.paid();
            if (id === answered) await entry.answered!('$reply');
        }
        await client.del(`matrix:event:${lost}`);
        await pause(150);
        const scan = await inboxOn({ maxTries: 1 }).recover();
        // the stale branch of the scan is met below, with an age limit in the past
        expect(Object.fromEntries(scan.closed!.map((c) => [c.eventId, c.why]))).toMatchObject({ [paid]: 'paid', [spent]: 'tries', [lost]: 'lost', [answered]: 'answered' });
        expect(await why(paid)).toBe('paid');
        expect(await why(spent)).toBe('tries');
        expect(await why(lost)).toBe('lost');
        expect(await client.exists(`matrix:outbox:${answered}`)).toBe(0);
        const stale = fresh('stale-scan');
        const gone = (await inboxOn({ owner: 'dies' }).take(stale, say(roomOf('stale-scan'), stale, 'd'))) as InboxEntry;
        await gone.admit();
        await pause(150);
        const staleScan = await inboxOn({ unfinishedMaxMs: -1000 }).recover();
        expect(staleScan.closed!.find((c) => c.eventId === stale)?.why).toBe('stale');
        expect(await why(stale)).toBe('stale');
    });

    it('a notice with nobody to tell (not a person\'s message) leaves the outbox without a send', async () => {
        quiet();
        const room = roomOf('member');
        const id = fresh('member');
        const dead = inboxOn({ owner: 'dies' });
        const entry = (await dead.take(id, { ...say(room, id, ''), type: 'm.room.member', content: { membership: 'join' } })) as InboxEntry;
        await entry.admit();
        await entry.paid();
        await pause(150);
        const matrix = fakeMatrix();
        const B = bridgeOn(room, matrix);
        const b = await serve(inboxOn(), B.handler);
        await b.router.recover();
        await vi.waitFor(async () => expect(await client.exists(`matrix:outbox:${id}`)).toBe(0));
        expect(matrix.sendMessage).not.toHaveBeenCalled();
    });
});
