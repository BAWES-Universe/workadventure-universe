import { randomUUID } from 'crypto';
import { createClient } from 'redis';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createMatrixAppServiceRouter, type MatrixEvent, type MatrixEventHandler } from '../matrix/MatrixAppServiceRouter';
import { createEventInbox, EVENT_PENDING_SECONDS, INBOX_KEY, type EventInbox, type InboxEntry } from '../matrix/MatrixEventInbox';
import { takeTurnOnInbox } from './helpers/sharedInboxLock';

/**
 * GPT seventh note, G (a real Redis): a room's later events stay behind an earlier event that was given back; unfinished work does not expire like finished work; and an entry whose state
 * outlived its life is closed as work that may have begun (never handed out again, the person told), not dropped in silence.
 */
const URL = process.env.BOTS_TEST_REDIS_URL;
describe.runIf(!!URL)('the durable inbox, GPT seventh note G (a real Redis)', () => {
    const client = createClient({ url: URL });
    const used: string[] = [];
    const servers: Server[] = [];
    const config = { homeserverUrl: 'http://hs', domain: 'matrix.test', asToken: 'as-secret', hsToken: 'hs-secret' };
    let giveTurnBack: (() => Promise<void>) | undefined;
    beforeAll(async () => {
        await client.connect();
        giveTurnBack = await takeTurnOnInbox(client as never);
    }, 330_000);
    afterEach(async () => {
        if (used.length > 0) await client.del([...used.map((id) => `matrix:event:${id}`), ...used.map((id) => `matrix:inbox:${id}`), ...used.map((id) => `matrix:inbox-open:${id}`)]);
        for (const id of used) await client.zRem(INBOX_KEY, id);
        used.length = 0;
        vi.restoreAllMocks();
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
    const ROOM = () => `!room-${randomUUID()}:matrix.test`;
    const message = (id: string, room: string, at: number, body = 'Hi'): MatrixEvent => ({ type: 'm.room.message', room_id: room, sender: '@alice:matrix.test', event_id: id, origin_server_ts: at, content: { msgtype: 'm.text', body } });
    const inboxOn = (extra: Parameters<typeof createEventInbox>[1] = {}) => createEventInbox(() => client as never, { ttlSeconds: 60, beatEveryMs: 60_000, ...extra });
    const serve = async (inbox: EventInbox, onEvent: (event: MatrixEvent, hooks?: { paid: () => void | Promise<void> }) => Promise<void>, extra: Partial<MatrixEventHandler> = {}) => {
        const router = createMatrixAppServiceRouter(config, { onEvent, userExists: async () => true, ...extra }, { inbox });
        const app = express();
        app.use(router);
        const server = await new Promise<Server>((resolve) => {
            const s = app.listen(0, () => resolve(s));
        });
        servers.push(server);
        const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        const put = (txn: string, ...events: MatrixEvent[]) => fetch(`${base}/_matrix/app/v1/transactions/${txn}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer hs-secret' }, body: JSON.stringify({ events }) });
        return { router, put };
    };
    const stateOf = (id: string) => client.get(`matrix:event:${id}`);

    describe('G1: a room\'s later events wait behind an earlier one that was given back', () => {
        it('the first fails before anything was paid for: the second does NOT run first; both come back in their order and run Pause then Resume', async () => {
            const [a, b] = [fresh('pause'), fresh('resume')];
            const room = ROOM();
            vi.spyOn(console, 'error').mockImplementation(() => undefined);
            const handled: string[] = [];
            let failed = false;
            const { router, put } = await serve(inboxOn({ maxTries: 3 }), async (event) => {
                if (event.event_id === a && !failed) {
                    failed = true;
                    throw new Error('the first try fails');
                }
                handled.push(event.event_id);
            });
            expect((await put('t1', message(a, room, 1000, 'Pause'), message(b, room, 2000, 'Resume'))).status).toBe(200);
            await vi.waitFor(async () => expect([await stateOf(a), await stateOf(b)]).toEqual(['p|-|1', 'p|-|0']));
            // nothing of the second ran while the first was out
            expect(handled).toEqual([]);
            expect(await router.recover()).toBe(2);
            await vi.waitFor(() => expect(handled).toEqual([a, b]));
        });

        it('an event of that room that comes in a LATER transaction, while the first is still out, waits too', async () => {
            const [a, c] = [fresh('first'), fresh('later')];
            const room = ROOM();
            vi.spyOn(console, 'error').mockImplementation(() => undefined);
            const handled: string[] = [];
            let failed = false;
            const { router, put } = await serve(inboxOn({ maxTries: 3 }), async (event) => {
                if (event.event_id === a && !failed) {
                    failed = true;
                    throw new Error('the first try fails');
                }
                handled.push(event.event_id);
            });
            await put('t1', message(a, room, 1000));
            await vi.waitFor(async () => expect(await stateOf(a)).toBe('p|-|1'));
            await put('t2', message(c, room, 3000));
            await vi.waitFor(async () => expect(await stateOf(c)).toBe('p|-|0'));
            expect(handled).toEqual([]);
            expect(await router.recover()).toBe(2);
            await vi.waitFor(() => expect(handled).toEqual([a, c]));
        });

        it('waiting behind it uses up none of the later event\'s tries, however many scans it takes', async () => {
            const [a, b] = [fresh('held'), fresh('waiting')];
            const room = ROOM();
            vi.spyOn(console, 'error').mockImplementation(() => undefined);
            const handled: string[] = [];
            // the first event keeps failing (and has many tries), so the second can only wait
            const { router, put } = await serve(inboxOn({ maxTries: 10 }), async (event) => {
                if (event.event_id === a) throw new Error('fails');
                handled.push(event.event_id);
            });
            await put('t1', message(a, room, 1000), message(b, room, 2000));
            await vi.waitFor(async () => expect(await stateOf(b)).toBe('p|-|0'));
            for (let scan = 0; scan < 3; scan++) {
                // each scan takes both up; the first fails again and the second is put back untried
                await router.recover();
                await vi.waitFor(async () => expect(await stateOf(b)).toMatch(/^p\|-\|0$|^d$/));
            }
            // the second was never closed for tries while it only waited
            expect(await stateOf(b)).toBe('p|-|0');
            expect(handled).toEqual([]);
        });

        it('the first reaches its last try: it is told, and the later event is no longer held (it runs)', async () => {
            const [a, b] = [fresh('last'), fresh('after')];
            const room = ROOM();
            vi.spyOn(console, 'error').mockImplementation(() => undefined);
            const told: string[] = [];
            const handled: string[] = [];
            const { router, put } = await serve(
                inboxOn({ maxTries: 1 }),
                async (event) => {
                    if (event.event_id === a) throw new Error('fails');
                    handled.push(event.event_id);
                },
                { onGaveUp: async (event) => void told.push(event.event_id) }
            );
            await put('t1', message(a, room, 1000), message(b, room, 2000));
            await vi.waitFor(() => expect(told).toEqual([a]));
            await vi.waitFor(() => expect(handled).toEqual([b]));
            expect(await stateOf(b)).toBe('d');
            void router;
        });

        it('the first was handled elsewhere meanwhile: the next event of that room is not held', async () => {
            const [a, c] = [fresh('elsewhere'), fresh('next')];
            const room = ROOM();
            vi.spyOn(console, 'error').mockImplementation(() => undefined);
            const handled: string[] = [];
            let failed = false;
            const { router, put } = await serve(inboxOn({ maxTries: 3 }), async (event) => {
                if (event.event_id === a && !failed) {
                    failed = true;
                    throw new Error('fails');
                }
                handled.push(event.event_id);
            });
            await put('t1', message(a, room, 1000));
            await vi.waitFor(async () => expect(await stateOf(a)).toBe('p|-|1'));
            // another server took it up and finished it
            const other = inboxOn();
            const recovered = await other.recover();
            const mine = recovered.find((one) => (one.event as MatrixEvent).event_id === a);
            await mine!.entry.done();
            await put('t2', message(c, room, 3000));
            await vi.waitFor(() => expect(handled).toEqual([c]));
            void router;
        });

        it('rooms are independent: an event of another room is never held by a give-back elsewhere', async () => {
            const [a, other] = [fresh('one-room'), fresh('other-room')];
            vi.spyOn(console, 'error').mockImplementation(() => undefined);
            const handled: string[] = [];
            const { put } = await serve(inboxOn({ maxTries: 3 }), async (event) => {
                if (event.event_id === a) throw new Error('fails');
                handled.push(event.event_id);
            });
            await put('t1', message(a, ROOM(), 1000), message(other, ROOM(), 2000));
            await vi.waitFor(() => expect(handled).toEqual([other]));
        });
    });

    describe('G2: unfinished work does not expire like finished work', () => {
        it('an entry in progress lives the long life, its payload a day more; a finished one keeps only the short one', async () => {
            const id = fresh('life');
            const inbox = inboxOn();
            const entry = (await inbox.take(id, message(id, ROOM(), 1))) as InboxEntry;
            expect(await client.ttl(`matrix:event:${id}`)).toBeGreaterThan(EVENT_PENDING_SECONDS - 60);
            expect(await client.ttl(`matrix:inbox:${id}`)).toBeGreaterThan(EVENT_PENDING_SECONDS);
            await entry.release();
            expect(await client.ttl(`matrix:event:${id}`)).toBeGreaterThan(EVENT_PENDING_SECONDS - 60);
            expect(await client.ttl(`matrix:inbox:${id}`)).toBeGreaterThan(EVENT_PENDING_SECONDS);
            const taken = (await inboxOn().recover()).find((one) => (one.event as MatrixEvent).event_id === id);
            expect(taken).toBeDefined();
            expect(await client.ttl(`matrix:event:${id}`)).toBeGreaterThan(EVENT_PENDING_SECONDS - 60);
            await taken!.entry.done();
            expect(await stateOf(id)).toBe('d');
            expect(await client.ttl(`matrix:event:${id}`)).toBeLessThanOrEqual(60);
        });

        it('an event given back stays recoverable for longer than the short life (it used to expire with the done marks)', async () => {
            const id = fresh('stays');
            const short = inboxOn({ ttlSeconds: 1 });
            const entry = (await short.take(id, message(id, ROOM(), 1))) as InboxEntry;
            await entry.release();
            await new Promise((resolve) => setTimeout(resolve, 1500));
            expect(await stateOf(id)).toBe('p|-|1');
            const found = await inboxOn({ ttlSeconds: 1 }).recover();
            expect(found.map((one) => (one.event as MatrixEvent).event_id)).toEqual([id]);
        });

        it('a state that outlived its life while the event is still held is closed as work that may have begun: told once, never handed out', async () => {
            const id = fresh('lost');
            vi.spyOn(console, 'error').mockImplementation(() => undefined);
            const dead = inboxOn({ staleMs: 60 });
            await dead.take(id, message(id, ROOM(), 1));
            // its state expired (nobody took it up for the whole life) while its payload is still there
            await client.del(`matrix:event:${id}`);
            await new Promise((resolve) => setTimeout(resolve, 150));
            const told: Array<[string, string]> = [];
            const handled: string[] = [];
            const { router } = await serve(inboxOn({ staleMs: 60 }), async (event) => void handled.push(event.event_id), { onGaveUp: async (event, why) => void told.push([event.event_id, why]) });
            expect(await router.recover()).toBe(0);
            await vi.waitFor(() => expect(told).toEqual([[id, 'paid']]));
            expect(handled).toEqual([]);
            expect(await stateOf(id)).toBe('d');
            expect(await client.get(`matrix:inbox:${id}`)).toBeNull();
            // said once
            expect(await router.recover()).toBe(0);
            await new Promise((resolve) => setTimeout(resolve, 100));
            expect(told).toHaveLength(1);
        });

        it('a closed entry\'s own mark (kept in the payload slot) is not mistaken for a lost event', async () => {
            const id = fresh('closed-mark');
            vi.spyOn(console, 'error').mockImplementation(() => undefined);
            const inbox = inboxOn({ staleMs: 60, maxTries: 1 });
            const entry = (await inbox.take(id, message(id, ROOM(), 1))) as InboxEntry;
            expect(await entry.release()).toBe('closed');
            await client.del(`matrix:event:${id}`);
            await client.zAdd(INBOX_KEY, { score: 0, value: id });
            const told: string[] = [];
            const { router } = await serve(inboxOn({ staleMs: 60 }), async () => undefined, { onGaveUp: async (event) => void told.push(event.event_id) });
            await router.recover();
            await new Promise((resolve) => setTimeout(resolve, 100));
            expect(told).toEqual([]);
        });
    });
});
