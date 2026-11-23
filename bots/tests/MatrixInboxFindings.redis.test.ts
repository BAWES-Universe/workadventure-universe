import { randomUUID } from 'crypto';
import { createClient } from 'redis';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createMatrixAppServiceRouter, type MatrixEvent, type MatrixEventHandler } from '../matrix/MatrixAppServiceRouter';
import { MatrixDmBridge } from '../matrix/MatrixDmBridge';
import { createEventInbox, INBOX_KEY, PaidFenceError, type EventInbox, type InboxEntry } from '../matrix/MatrixEventInbox';
import { KEY_REDACTED_FIELD, withoutKeys } from '../matrix/KeyInChat';
import { takeTurnOnInbox } from './helpers/sharedInboxLock';

/**
 * CodeRabbit on game #2114 (review of b2efeeb6): the durable inbox on a real Redis. A key typed into the chat never reaches the store (I10), every acquisition of an entry has its own token
 * (I11), the fence before paid work must succeed (I9), events that share a time keep their arrival order, a slow scan ends on its deadline and one runs at a time, a transaction still being
 * taken in is not acknowledged to a duplicate, shutdown waits for it, and a store that is expected but not connected refuses the transaction.
 */
const URL = process.env.BOTS_TEST_REDIS_URL;
describe.runIf(!!URL)('the durable inbox, CodeRabbit pass on #2114 (a real Redis)', () => {
    const client = createClient({ url: URL });
    const used: string[] = [];
    const servers: Server[] = [];
    const config = { homeserverUrl: 'http://hs', domain: 'matrix.test', asToken: 'as-secret', hsToken: 'hs-secret' };
    let giveTurnBack: (() => Promise<void>) | undefined;
    beforeAll(async () => {
        await client.connect();
        // the inbox is one set in the shared Redis: this file has it to itself while it runs (CodeRabbit on d098522a)
        giveTurnBack = await takeTurnOnInbox(client as never);
    }, 330_000);
    afterEach(async () => {
        if (used.length > 0) await client.del([...used.map((id) => `matrix:event:${id}`), ...used.map((id) => `matrix:inbox:${id}`)]);
        for (const id of used) await client.zRem(INBOX_KEY, id);
        used.length = 0;
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
    const message = (id: string, body = 'Hi', at?: number): MatrixEvent => ({ type: 'm.room.message', room_id: `!room-${id}:matrix.test`, sender: '@alice:matrix.test', event_id: id, ...(at === undefined ? {} : { origin_server_ts: at }), content: { msgtype: 'm.text', body } });
    const inboxOn = (extra: Parameters<typeof createEventInbox>[1] = {}) => createEventInbox(() => client as never, { ttlSeconds: 60, beatEveryMs: 60_000, ...extra });
    const serve = async (inbox: EventInbox, onEvent: (event: MatrixEvent, hooks?: { paid: () => void | Promise<void> }) => Promise<void> = async () => undefined, extra: Partial<MatrixEventHandler> = {}) => {
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

    describe('I10: a key typed into the chat is never written to the shared store', () => {
        const KEY = ['sk_', 'live_51Habcdefghijklmnop12345'].join('');
        it('the stored event holds no key and says one was there; an event with none is stored as it is', async () => {
            const id = fresh('key');
            const inbox = inboxOn();
            const taken = await inbox.take(id, message(id, `here it is: ${KEY}`));
            expect(taken).not.toBe(false);
            const stored = (await client.get(`matrix:inbox:${id}`)) as string;
            expect(stored).not.toContain(KEY);
            expect(stored).not.toContain('sk_');
            expect(JSON.parse(stored).event.content[KEY_REDACTED_FIELD]).toBe(true);
            await (taken as InboxEntry).release();
            const plain = fresh('plain');
            await inbox.take(plain, message(plain, 'just words'));
            expect(JSON.parse((await client.get(`matrix:inbox:${plain}`)) as string).event.content).toEqual({ msgtype: 'm.text', body: 'just words' });
        });

        it('what a server takes up from the store is the event with the mark, so the Brick still refuses it', async () => {
            const id = fresh('key-recover');
            const dead = inboxOn({ staleMs: 60 });
            const alive = inboxOn({ staleMs: 60 });
            await dead.take(id, message(id, `Authorization: Bearer ${'a'.repeat(40)}`));
            await new Promise((resolve) => setTimeout(resolve, 150));
            const [left] = await alive.recover();
            const content = (left.event as MatrixEvent).content;
            expect(content[KEY_REDACTED_FIELD]).toBe(true);
            expect(JSON.stringify(left.event)).not.toContain('a'.repeat(40));
            await left.entry.done();
        });

        it('withoutKeys goes through every text of the event, and leaves the original alone', () => {
            const original = { type: 'm.room.message', content: { body: 'ok', formatted_body: `<p>${KEY}</p>`, nested: { list: [`x ${KEY}`] } } };
            const clean = withoutKeys(original);
            expect(JSON.stringify(clean)).not.toContain(KEY);
            expect((clean as typeof original).content.body).toBe('ok');
            expect(JSON.stringify(original)).toContain(KEY);
            expect(withoutKeys({ a: 'b' })).toEqual({ a: 'b' });
        });
    });

    describe('I11: every acquisition of an entry has its own token', () => {
        it('a handle whose entry was recovered (even by the same server) can neither finish, give back nor mark it', async () => {
            const id = fresh('token');
            const inbox = inboxOn({ staleMs: 60, owner: 'same-server' });
            const first = (await inbox.take(id, message(id))) as InboxEntry;
            await new Promise((resolve) => setTimeout(resolve, 150));
            const [again] = await inbox.recover();
            expect(again).toBeDefined();
            const recovered = await stateOf(id);
            expect(recovered).toMatch(/^p\|same-server:/);
            // the old handle: nothing it does touches the recovered acquisition
            await expect(first.paid()).rejects.toThrow(PaidFenceError);
            await first.done();
            expect(await stateOf(id)).toBe(recovered);
            expect(await client.get(`matrix:inbox:${id}`)).not.toBeNull();
            // the new one finishes it
            await again.entry.done();
            expect(await stateOf(id)).toBe('d');
        });
    });

    describe('I9: paid work begins only once the fence was written', () => {
        it('a lost fence and a store that did not answer both throw, and write nothing', async () => {
            const id = fresh('fence');
            const inbox = inboxOn({ owner: 'one' });
            const entry = (await inbox.take(id, message(id))) as InboxEntry;
            // another server took it meanwhile
            await client.set(`matrix:event:${id}`, 'p|two:abc|2');
            await expect(entry.paid()).rejects.toThrow(PaidFenceError);
            expect(await stateOf(id)).toBe('p|two:abc|2');
            // a store that does not answer
            const id2 = fresh('fence2');
            const down = createEventInbox(() => ({ eval: async (script: string, o: unknown) => (script.includes("'|$'") ? Promise.reject(new Error('down')) : (client as never as { eval: (s: string, o: unknown) => Promise<unknown> }).eval(script, o)) }) as never, { ttlSeconds: 60, beatEveryMs: 60_000, log: () => undefined });
            const held = (await down.take(id2, message(id2))) as InboxEntry;
            await expect(held.paid()).rejects.toThrow(PaidFenceError);
            expect(await stateOf(id2)).toMatch(/^p\|/);
            expect(await stateOf(id2)).not.toMatch(/\|\$$/);
        });

        it('through the router: a handler whose fence fails starts nothing and the event is given back, never closed', async () => {
            const id = fresh('route');
            const noFence = createEventInbox(() => ({ eval: async (script: string, o: unknown) => (script.includes("'|$'") ? Promise.reject(new Error('down')) : (client as never as { eval: (s: string, o: unknown) => Promise<unknown> }).eval(script, o)) }) as never, { ttlSeconds: 60, beatEveryMs: 60_000, log: () => undefined });
            let began = 0;
            const { put } = await serve(noFence, async (_event, hooks) => {
                await hooks?.paid();
                began += 1;
            });
            expect((await put('t1', message(id))).status).toBe(200);
            await vi.waitFor(async () => expect(await stateOf(id)).toMatch(/^p\|-\|/));
            expect(began).toBe(0);
        });
    });

    describe('events that share a time keep the order they came in', () => {
        it('two events of one room with the same origin_server_ts are handled in arrival order when a server takes them up, whatever their ids sort as', async () => {
            const room = '!one-room:matrix.test';
            const later = `$zzz-${randomUUID()}`;
            const earlier = `$aaa-${randomUUID()}`;
            used.push(later, earlier);
            const dead = inboxOn({ staleMs: 60 });
            // the id that sorts LAST arrived first
            await dead.take(later, { ...message(later, 'first'), room_id: room, origin_server_ts: 1_700_000_000_000 });
            await dead.take(earlier, { ...message(earlier, 'second'), room_id: room, origin_server_ts: 1_700_000_000_000 });
            await new Promise((resolve) => setTimeout(resolve, 150));
            const order: string[] = [];
            const alive = inboxOn({ staleMs: 60 });
            const { router } = await serve(alive, async (event) => {
                order.push(event.event_id);
            });
            expect(await router.recover()).toBe(2);
            await vi.waitFor(() => expect(order).toHaveLength(2));
            expect(order).toEqual([later, earlier]);
        });
    });

    describe('the recovery scan', () => {
        it('ends on its deadline when the store accepts the call and never answers, and only one runs at a time', async () => {
            let scans = 0;
            const stalled = createEventInbox(() => ({ eval: async () => 0, zRangeByScore: () => (scans++, new Promise<string[]>(() => undefined)) }) as never, { deadlineMs: 60, log: () => undefined });
            const { router } = await serve(stalled);
            const began = Date.now();
            const [one, two] = await Promise.all([router.recover(), router.recover()]);
            expect(one).toBe(0);
            expect(two).toBe(0);
            expect(Date.now() - began).toBeLessThan(2000);
            expect(scans).toBe(1);
            // finished: the next tick looks again
            await router.recover();
            expect(scans).toBe(2);
        });
    });

    describe('I7: a duplicate of a transaction still being taken in', () => {
        const slowTake = (fail: boolean) => {
            const real = inboxOn();
            let release!: () => void;
            const gate = new Promise<void>((resolve) => (release = resolve));
            const inbox: EventInbox = {
                owner: real.owner,
                recover: () => real.recover(),
                take: async (id, event) => {
                    await gate;
                    if (fail) throw new Error('down');
                    return real.take(id, event);
                },
            };
            return { inbox, release };
        };

        it('is answered when the first intake is, and is told 500 when that intake failed (never 200 for events that were not kept)', async () => {
            const id = fresh('dup-fail');
            const { inbox, release } = slowTake(true);
            vi.spyOn(console, 'error').mockImplementation(() => undefined);
            const { put } = await serve(inbox);
            const first = put('t1', message(id));
            const second = put('t1', message(id));
            await new Promise((resolve) => setTimeout(resolve, 100));
            release();
            const [a, b] = await Promise.all([first, second]);
            expect(a.status).toBe(500);
            expect(b.status).toBe(500);
        });

        it('is told 200 once the events are kept, and they are handled once', async () => {
            const id = fresh('dup-ok');
            const { inbox, release } = slowTake(false);
            const seen: string[] = [];
            const { put } = await serve(inbox, async (event) => void seen.push(event.event_id));
            const first = put('t1', message(id));
            const second = put('t1', message(id));
            await new Promise((resolve) => setTimeout(resolve, 100));
            release();
            const [a, b] = await Promise.all([first, second]);
            expect([a.status, b.status]).toEqual([200, 200]);
            await vi.waitFor(() => expect(seen).toEqual([id]));
            // and a copy that comes later is a duplicate of events that are kept
            expect((await put('t1', message(id))).status).toBe(200);
            expect(seen).toEqual([id]);
        });
    });

    describe('shutdown waits for work that was already admitted', () => {
        it('a transaction still being taken in when shutdown begins is handled before settle returns', async () => {
            const id = fresh('drain');
            const real = inboxOn();
            let release!: () => void;
            const gate = new Promise<void>((resolve) => (release = resolve));
            // the request is known to be inside `take` (admitted, not yet kept) before shutdown begins: no fixed delay stands in for that
            let admit!: () => void;
            const admitted = new Promise<void>((resolve) => (admit = resolve));
            const inbox: EventInbox = {
                owner: real.owner,
                recover: () => real.recover(),
                take: async (eventId, event) => {
                    admit();
                    await gate;
                    return real.take(eventId, event);
                },
            };
            const handled: string[] = [];
            const { router, put } = await serve(inbox, async (event) => {
                await new Promise((resolve) => setTimeout(resolve, 50));
                handled.push(event.event_id);
            });
            const sending = put('t1', message(id));
            await admitted;
            const settled = router.settle(5000);
            release();
            expect(await settled).toBe(true);
            // the handler had run to its end by the time settle said so
            expect(handled).toEqual([id]);
            expect((await sending).status).toBe(200);
        });
    });

    describe('M4: a store that is expected but not connected', () => {
        it('refuses the transaction (500, so Synapse sends it again) and handles nothing; with none expected the event is handled and nothing is remembered', async () => {
            const id = fresh('absent');
            vi.spyOn(console, 'error').mockImplementation(() => undefined);
            const handled: string[] = [];
            const expecting = await serve(createEventInbox(() => null, { expected: () => true }), async (event) => void handled.push(event.event_id));
            expect((await expecting.put('t1', message(id))).status).toBe(500);
            await new Promise((resolve) => setTimeout(resolve, 80));
            expect(handled).toEqual([]);
            // the resend (the store is back) is taken in whole
            const fine = await serve(inboxOn(), async (event) => void handled.push(event.event_id));
            expect((await fine.put('t1', message(id))).status).toBe(200);
            await vi.waitFor(() => expect(handled).toEqual([id]));
            const quiet = await serve(createEventInbox(() => null), async (event) => void handled.push(`quiet-${event.event_id}`));
            expect((await quiet.put('t2', message(id))).status).toBe(200);
            await vi.waitFor(() => expect(handled).toContain(`quiet-${id}`));
        });
    });

    // CodeRabbit on #2114 (review of d098522a)
    describe('the inbox and the router, CodeRabbit pass on d098522a', () => {
        const realEval = (script: string, o: unknown) => (client as never as { eval: (s: string, o: unknown) => Promise<unknown> }).eval(script, o);
        /** The scripts, told apart by what each one contains. */
        const isPaid = (script: string) => script.includes("held .. '|$'");
        const isRelease = (script: string) => script.includes("'p|-|' .. tostring(tries)");

        it('RELEASE keeps the count of tries when it takes a paid mark off, so an event that fails every time still ends after its last try', async () => {
            const id = fresh('release-count');
            const inbox = inboxOn({ owner: 'one', beatEveryMs: 60_000 });
            let entry = (await inbox.take(id, message(id))) as InboxEntry;
            for (const expected of [1, 2]) {
                await entry.paid();
                expect(await stateOf(id)).toMatch(/\|\$$/);
                await entry.release();
                // the count behind the mark is read, never reset to 1
                expect(await stateOf(id)).toBe(`p|-|${expected}`);
                [{ entry }] = await inbox.recover();
            }
            await entry.paid();
            await entry.release();
            // the third try was the last one: the event is closed
            expect(await stateOf(id)).toBe('d');
            expect(await client.zScore(INBOX_KEY, id)).toBeNull();
        });

        it('arrival stamps never go back: not within one millisecond, not when the clock steps back', async () => {
            const inbox = inboxOn();
            const stamps: number[] = [];
            const now = vi.spyOn(Date, 'now');
            try {
                const arrive = async (at: number) => {
                    now.mockReturnValue(at);
                    const id = fresh('stamp');
                    await inbox.take(id, message(id)).then((taken) => (taken as InboxEntry).release());
                    stamps.push(JSON.parse((await client.get(`matrix:inbox:${id}`)) as string).arrived);
                };
                const T = 1_800_000_000_000;
                // more events in one millisecond than the old counter had room for, then the clock goes back five seconds, then forward again
                for (let i = 0; i < 1005; i++) await arrive(T);
                for (let i = 0; i < 3; i++) await arrive(T - 5000);
                await arrive(T + 1);
            } finally {
                now.mockRestore();
            }
            for (let i = 1; i < stamps.length; i++) expect(stamps[i], `stamp ${i}`).toBeGreaterThan(stamps[i - 1]);
        });

        it('a paid mark the store wrote but never confirmed is taken off again: the event goes back, the work never began, and no other server closes it meanwhile', async () => {
            const id = fresh('lost-paid');
            let paidAnswers = 0;
            let giveBacks = 0;
            const flaky = createEventInbox(
                () =>
                    ({
                        eval: async (script: string, o: unknown) => {
                            if (isPaid(script)) {
                                // the write COMMITS and the answer is lost
                                await realEval(script, o);
                                paidAnswers += 1;
                                throw new Error('answer lost');
                            }
                            if (isRelease(script) && ++giveBacks <= 2) throw new Error('store down');
                            return realEval(script, o);
                        },
                    }) as never,
                { ttlSeconds: 60, beatEveryMs: 40, staleMs: 400, deadlineMs: 200, log: () => undefined }
            );
            let began = 0;
            const { put } = await serve(flaky, async (_event, hooks) => {
                await hooks?.paid();
                began += 1;
            });
            vi.spyOn(console, 'error').mockImplementation(() => undefined);
            expect((await put('t1', message(id))).status).toBe(200);
            await vi.waitFor(() => expect(paidAnswers).toBe(1));
            // the first give-backs fail: the entry still carries the mark, and another server that looks finds it alive (the beats go on) and takes nothing
            const other = inboxOn({ staleMs: 400 });
            expect(await other.recover()).toEqual([]);
            expect(await stateOf(id)).toMatch(/\|\$$/);
            // the give-back is tried again until the store takes it: the mark is gone and the entry waits for a try
            await vi.waitFor(async () => expect(await stateOf(id)).toMatch(/^p\|-\|1$/), { timeout: 4000 });
            expect(began).toBe(0);
            // another server takes it up and handles it (it was never paid for)
            const [left] = await other.recover();
            expect(left).toBeDefined();
            expect(await stateOf(id)).toMatch(/^p\|.*\|2$/);
            await left.entry.done();
        });

        it('the same event in two transactions: the second never counts an event as kept while the first intake can still roll it back', async () => {
            const [first, second] = [fresh('twice-a'), fresh('twice-b')];
            const real = inboxOn();
            let release!: () => void;
            const gate = new Promise<void>((resolve) => (release = resolve));
            let failSecond = true;
            vi.spyOn(console, 'error').mockImplementation(() => undefined);
            const inbox: EventInbox = {
                owner: real.owner,
                recover: () => real.recover(),
                take: async (id, event) => {
                    if (id === second && failSecond) {
                        failSecond = false;
                        await gate;
                        throw new Error('down');
                    }
                    return real.take(id, event);
                },
            };
            const handled: string[] = [];
            const { put } = await serve(inbox, async (event) => void handled.push(event.event_id));
            // t1 carries both events and its second one fails (after the gate), so t1 is rolled back; t2 carries the first event again
            const one = put('t1', message(first), message(second));
            await new Promise((resolve) => setTimeout(resolve, 60));
            let answered = false;
            const two = put('t2', message(first)).then((res) => ((answered = true), res));
            await new Promise((resolve) => setTimeout(resolve, 100));
            // t2 is not answered while t1 can still take its events back
            expect(answered).toBe(false);
            release();
            const [a, b] = await Promise.all([one, two]);
            expect(a.status).toBe(500);
            expect(b.status).toBe(200);
            // the event of both transactions was handled once, by the second
            await vi.waitFor(() => expect(handled).toEqual([first]));
            await new Promise((resolve) => setTimeout(resolve, 100));
            expect(handled).toEqual([first]);
        });

        describe('an event that will not be handled again is said, never dropped in silence (Opus on cfcac71a)', () => {
            it('its last try failed before anything was paid for: the handler is told it ran out of tries, once', async () => {
                const id = fresh('lasttry');
                vi.spyOn(console, 'error').mockImplementation(() => undefined);
                const told: Array<[string, string]> = [];
                const inbox = inboxOn({ maxTries: 3, staleMs: 60 });
                const { router, put } = await serve(
                    inbox,
                    async () => {
                        throw new Error('handler error');
                    },
                    { onGaveUp: async (event, why) => void told.push([event.event_id, why]) }
                );
                expect((await put('t1', message(id))).status).toBe(200);
                await vi.waitFor(async () => expect(await stateOf(id)).toBe('p|-|1'));
                for (const tries of [2, 3]) {
                    expect(told).toEqual([]);
                    expect(await router.recover()).toBe(1);
                    await vi.waitFor(async () => expect(await stateOf(id)).toBe(tries === 3 ? 'd' : `p|-|${tries}`));
                }
                await vi.waitFor(() => expect(told).toEqual([[id, 'tries']]));
            });

            it('a scan that closes an entry whose server went away after work had begun reports it as paid; one that had all its tries reports tries; neither is handed out', async () => {
                const [paidId, triesId] = [fresh('closed-paid'), fresh('closed-tries')];
                vi.spyOn(console, 'error').mockImplementation(() => undefined);
                const dead = inboxOn({ staleMs: 60, maxTries: 1 });
                const gone = (await dead.take(paidId, message(paidId))) as InboxEntry;
                await gone.paid();
                await dead.take(triesId, message(triesId));
                await new Promise((resolve) => setTimeout(resolve, 150));
                const told: Array<[string, string]> = [];
                const handled: string[] = [];
                const { router } = await serve(
                    inboxOn({ staleMs: 60, maxTries: 1 }),
                    async (event) => void handled.push(event.event_id),
                    { onGaveUp: async (event, why) => void told.push([event.event_id, why]) }
                );
                expect(await router.recover()).toBe(0);
                await vi.waitFor(() => expect(told.sort()).toEqual([[paidId, 'paid'], [triesId, 'tries']].sort()));
                expect(handled).toEqual([]);
                expect(await stateOf(paidId)).toBe('d');
                expect(await stateOf(triesId)).toBe('d');
            });

            it('the closed list is not an element of what a scan returns, so a scan that took nothing is an empty list', async () => {
                const id = fresh('plain-empty');
                const dead = inboxOn({ staleMs: 60 });
                await (await dead.take(id, message(id)) as InboxEntry).paid();
                await new Promise((resolve) => setTimeout(resolve, 150));
                const found = await inboxOn({ staleMs: 60 }).recover();
                expect(found).toEqual([]);
                expect(found.closed).toHaveLength(1);
            });
        });

        it('a server that went away while an event was held for a store that was down: another server takes the entry over and the person is answered once', async () => {
            const id = fresh('held-died');
            const botId = '0b7c1d2e-1111-4222-8333-944455556666';
            const botUser = `@bot_${botId}:matrix.test`;
            const room = `!room-${id}:matrix.test`;
            vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            const makeBridge = (storeDown: boolean) => {
                const rooms = new Map<string, string>([[room, botId]]);
                const deps: any = {
                    getBotConfig: vi.fn(async () => ({ botId, name: 'Guide', enabled: true, aiProviderRef: 'p' })),
                    checkAccess: vi.fn(async () => ({ allowed: true, reason: null, user: { uuid: 'uuid-alice', name: 'Alice', isGuest: false } })),
                    reply: vi.fn(async () => ({ text: 'Hello Alice!', media: [] })),
                    rooms: {
                        rememberDmRoom: vi.fn(async () => undefined),
                        getDmRoomBot: vi.fn(async (r: string) => {
                            if (storeDown) throw new Error('Redis is reconnecting');
                            return rooms.get(r) ?? null;
                        }),
                        forgetDmRoom: vi.fn(async () => undefined),
                    },
                };
                const client: any = {
                    ensureRegistered: vi.fn(async () => undefined),
                    setDisplayName: vi.fn(async () => undefined),
                    getDisplayName: vi.fn(async () => 'Guide'),
                    joinRoom: vi.fn(async () => undefined),
                    leaveRoom: vi.fn(async () => undefined),
                    sendText: vi.fn(async () => '$evt'),
                    sendMessage: vi.fn(async () => '$evt'),
                    setTyping: vi.fn(async () => undefined),
                    getJoinedMembers: vi.fn(async () => ['@alice:matrix.test', botUser]),
                    getRecentMessages: vi.fn(async () => []),
                };
                return { bridge: new MatrixDmBridge(config, client as never, deps), deps };
            };
            const first = makeBridge(true);
            // the first server never beats (it is as good as gone once its beat is stale) and its lookup stays down
            const aliveFirst = inboxOn({ staleMs: 60, beatEveryMs: 60_000 });
            const one = await serve(aliveFirst, (event, hooks) => first.bridge.onEvent(event, hooks));
            expect((await one.put('t1', message(id, 'Hello?'))).status).toBe(200);
            await vi.waitFor(() => expect(first.deps.rooms.getDmRoomBot).toHaveBeenCalled());
            expect(await stateOf(id)).toMatch(/^p\|/);
            expect(first.deps.reply).not.toHaveBeenCalled();
            await new Promise((resolve) => setTimeout(resolve, 150));
            // the event is still HELD by its first acquisition: a store that is down did not count as a try and did not give the entry back
            expect(await stateOf(id)).toMatch(/^p\|(?!-\|).*\|1$/);
            // another server takes the stale entry over (a new acquisition) and answers
            const second = makeBridge(false);
            const two = await serve(inboxOn({ staleMs: 60, beatEveryMs: 60_000 }), (event, hooks) => second.bridge.onEvent(event, hooks));
            expect(await two.router.recover()).toBe(1);
            await vi.waitFor(async () => expect(await stateOf(id)).toBe('d'));
            expect(second.deps.reply).toHaveBeenCalledTimes(1);
            // the first server stops: its held event is given back under the old acquisition, which changes nothing and answers nothing
            await first.bridge.stop();
            await new Promise((resolve) => setTimeout(resolve, 100));
            expect(first.deps.reply).not.toHaveBeenCalled();
            expect(await stateOf(id)).toBe('d');
            expect(second.deps.reply).toHaveBeenCalledTimes(1);
        });
    });
});
