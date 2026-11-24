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
 * GPT's seventh note, finding G, on a real Redis through the real router:
 * - G1: "Pause the job" then "Resume the job" in one room; the first handler fails before paid work. The later action must wait behind the unresolved earlier one (here and at another
 *   server), and other rooms go on meanwhile.
 * - G2: an unfinished entry and its event must not expire like a completed dedupe record: recovery finds it after the completed records' time is over.
 */
const URL = process.env.BOTS_TEST_REDIS_URL;
describe.runIf(!!URL)('room order and unfinished entries survive recovery (GPT seventh note, G; a real Redis)', () => {
    const client = createClient({ url: URL });
    const used: string[] = [];
    const rooms: string[] = [];
    const servers: Server[] = [];
    const config = { homeserverUrl: 'http://hs', domain: 'matrix.test', asToken: 'as-secret', hsToken: 'hs-secret' };
    let giveTurnBack: (() => Promise<void>) | undefined;
    beforeAll(async () => {
        await client.connect();
        giveTurnBack = await takeTurnOnInbox(client as never);
    }, 330_000);
    /**
     * What a test leaves running is stopped before its keys go and before the client closes (CodeRabbit on 68379005, finding 17): routers settle (a parked event is handed back, its timer
     * cleared), work a test held open is let go (newest first), and every entry a test took or recovered ends, so no beat calls the store after the suite.
     */
    const cleanups: Array<() => unknown> = [];
    const entries: InboxEntry[] = [];
    afterEach(async () => {
        for (const cleanup of cleanups.splice(0).reverse()) await Promise.resolve(cleanup()).catch(() => undefined);
        await Promise.all(entries.splice(0).map((entry) => entry.done().catch(() => undefined)));
        vi.restoreAllMocks();
        const keys = await client.keys('matrix:*');
        const mine = keys.filter((key) => used.some((id) => key.endsWith(id)) || rooms.some((room) => key.endsWith(room)));
        if (mine.length > 0) await client.del(mine);
        for (const id of used) await client.zRem(INBOX_KEY, id);
        // the outbox's index (its notices went with the keys above: GPT's eighth note G)
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
    let clock = 1_700_000_000_000;
    const say = (room: string, id: string, body: string): MatrixEvent => ({
        type: 'm.room.message',
        room_id: room,
        sender: '@alice:matrix.test',
        event_id: id,
        origin_server_ts: (clock += 10),
        content: { msgtype: 'm.text', body },
    });
    /** An inbox whose entries are kept for the teardown (it ends them, so none beats after the suite). */
    const tracked = (inbox: EventInbox): EventInbox => ({
        owner: inbox.owner,
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
    });
    const inboxOn = (extra: Parameters<typeof createEventInbox>[1] = {}) => tracked(createEventInbox(() => client as never, { ttlSeconds: 60, beatEveryMs: 60_000, ...extra }));
    const serve = async (inbox: EventInbox, onEvent: MatrixEventHandler['onEvent'], extra: Partial<MatrixEventHandler> = {}) => {
        const router = createMatrixAppServiceRouter(config, { onEvent, userExists: async () => true, ...extra }, { inbox, waitCheckMs: 50 });
        cleanups.push(() => router.settle(500));
        const app = express();
        app.use(router);
        const server = await new Promise<Server>((resolve) => {
            const s = app.listen(0, () => resolve(s));
        });
        servers.push(server);
        const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        const put = (txn: string, ...events: MatrixEvent[]) =>
            fetch(`${base}/_matrix/app/v1/transactions/${txn}-${randomUUID()}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer hs-secret' }, body: JSON.stringify({ events }) });
        return { router, put };
    };
    const stateOf = (id: string) => client.get(`matrix:event:${id}`);
    const quiet = () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    };
    const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    describe('G1: later actions in a room wait behind an unresolved earlier one', () => {
        it("GPT's case: Pause fails before paid work, Resume came in the same transaction; Resume is handled only after Pause, and another room goes on meanwhile", async () => {
            quiet();
            const room = roomOf('jobs');
            const other = roomOf('other');
            const [pauseId, resumeId, elsewhere] = [fresh('pause'), fresh('resume'), fresh('elsewhere')];
            const order: string[] = [];
            let failedOnce = false;
            const { router, put } = await serve(inboxOn({ staleMs: 60 }), async (event) => {
                if (event.event_id === pauseId && !failedOnce) {
                    failedOnce = true;
                    throw new Error('Orbit did not answer (before anything was paid for)');
                }
                order.push(String(event.content.body));
            });
            expect((await put('t1', say(room, pauseId, 'Pause the job'), say(room, resumeId, 'Resume the job'), say(other, elsewhere, 'Hello'))).status).toBe(200);
            // the other room is not held by the failure in this one
            await vi.waitFor(() => expect(order).toContain('Hello'));
            await vi.waitFor(async () => expect(await stateOf(pauseId)).toBe('p|-|1'));
            await pause(150);
            // Resume has not run ahead of the Pause that is still unresolved
            expect(order).not.toContain('Resume the job');
            // the retry of Pause (the next scan) runs it, and Resume follows it
            await router.recover();
            await vi.waitFor(() => expect(order.filter((one) => one !== 'Hello')).toEqual(['Pause the job', 'Resume the job']));
            await vi.waitFor(async () => expect([await stateOf(pauseId), await stateOf(resumeId), await stateOf(elsewhere)]).toEqual(['d', 'd', 'd']));
        });

        it('across servers: the server holding Pause went away; Resume reaches another server in a later transaction and waits until Pause is taken up and handled', async () => {
            quiet();
            const room = roomOf('jobs-two');
            const other = roomOf('other-two');
            const [pauseId, resumeId, elsewhere] = [fresh('pause2'), fresh('resume2'), fresh('elsewhere2')];
            // server A takes Pause in and never finishes it (as good as gone: it never beats again); its handler is let go in the teardown
            let releaseA: (() => void) | undefined;
            const A = await serve(inboxOn({ owner: 'server-a', staleMs: 60 }), () => new Promise<void>((resolve) => (releaseA = resolve)));
            cleanups.push(() => releaseA?.());
            expect((await A.put('t1', say(room, pauseId, 'Pause the job'))).status).toBe(200);
            const order: string[] = [];
            // B beats (Resume, which it holds while it waits, stays fresh): only Pause, which A never beats, goes stale (CodeRabbit on 68379005, finding 18)
            let ranAs: string | null = null;
            const B = await serve(inboxOn({ owner: 'server-b', staleMs: 60, beatEveryMs: 20 }), async (event) => {
                if (event.event_id === resumeId) ranAs = await stateOf(resumeId);
                order.push(String(event.content.body));
            });
            expect((await B.put('t2', say(room, resumeId, 'Resume the job'), say(other, elsewhere, 'Hello'))).status).toBe(200);
            await vi.waitFor(() => expect(order).toContain('Hello'));
            await pause(150);
            expect(order).not.toContain('Resume the job');
            const waitingAs = await stateOf(resumeId);
            expect(waitingAs).toMatch(/^p\|[^-|][^|]*\|0$/);
            // B takes the stale Pause over, and only Pause: Resume wakes under the acquisition it had all along
            expect(await B.router.recover()).toBe(1);
            await vi.waitFor(() => expect(order.filter((one) => one !== 'Hello')).toEqual(['Pause the job', 'Resume the job']));
            expect(await stateOf(resumeId)).toBe('d');
            // the acquisition Resume waited under is the one that ran it (it was never taken again), and its try was counted when it ran
            expect(ranAs).toBe(`p|${waitingAs!.split('|')[1]}|1`);
        });

        it('an earlier event that ran out of tries is resolved (the person is told), so the later one then runs', async () => {
            quiet();
            const room = roomOf('jobs-tries');
            const [failing, later] = [fresh('fails'), fresh('later')];
            const order: string[] = [];
            const told: string[] = [];
            const { router, put } = await serve(
                inboxOn({ staleMs: 60, maxTries: 2 }),
                async (event) => {
                    if (event.event_id === failing) throw new Error('always fails');
                    order.push(event.event_id);
                },
                { onGaveUp: async (event) => void told.push(event.event_id) }
            );
            expect((await put('t1', say(room, failing, 'one'), say(room, later, 'two'))).status).toBe(200);
            await vi.waitFor(async () => expect(await stateOf(failing)).toBe('p|-|1'));
            await pause(100);
            expect(order).toEqual([]);
            await router.recover();
            await vi.waitFor(() => expect(told).toEqual([failing]));
            await vi.waitFor(() => expect(order).toEqual([later]));
        });
    });

    describe('G2: unfinished entries do not expire like completed dedupe records', () => {
        it('an entry taken in and never handled (no beat) is still found by recovery after the completed records would have expired', async () => {
            quiet();
            const room = roomOf('expiry');
            const id = fresh('expiry');
            // completed records live 1 s here; the server that took the event never beats and never finishes
            const dead = inboxOn({ ttlSeconds: 1, staleMs: 60 });
            const taken = (await dead.take(id, say(room, id, 'Pause the job'))) as InboxEntry;
            await taken.admit();
            await pause(2_200);
            const found = await inboxOn({ ttlSeconds: 1, staleMs: 60 }).recover();
            // never zero work and zero closures: the unfinished event is handed out again
            expect(found.map((one) => (one.event as MatrixEvent).event_id)).toEqual([id]);
            await found[0].entry.done();
        });

        it('an unfinished entry and its event carry no expiry; only the done record does', async () => {
            const room = roomOf('ttl');
            const id = fresh('ttl');
            const inbox = inboxOn({ ttlSeconds: 60, staleMs: 60 });
            const taken = (await inbox.take(id, say(room, id, 'Hi'))) as InboxEntry;
            await taken.admit();
            expect(await client.ttl(`matrix:event:${id}`)).toBe(-1);
            expect(await client.ttl(`matrix:inbox:${id}`)).toBe(-1);
            await taken.paid();
            expect(await client.ttl(`matrix:event:${id}`)).toBe(-1);
            await taken.done();
            expect(await client.ttl(`matrix:event:${id}`)).toBeGreaterThan(0);
        });

        it('an unfinished entry taken in more than a day ago is closed as unanswered, never run: the person is told once, and a redelivery is not handled', async () => {
            quiet();
            const room = roomOf('stale');
            const id = fresh('stale');
            // "a day" is 400 ms here; the server that took it went away
            const dead = inboxOn({ staleMs: 60, unfinishedMaxMs: 400 });
            await ((await dead.take(id, say(room, id, 'Pause the job'))) as InboxEntry).admit();
            await pause(600);
            const handled: string[] = [];
            const told: Array<[string, string]> = [];
            const { router, put } = await serve(inboxOn({ staleMs: 60, unfinishedMaxMs: 400, unansweredSeconds: 120 }), async (event) => void handled.push(event.event_id), {
                onGaveUp: async (event, why) => void told.push([event.event_id, why]),
            });
            expect(await router.recover()).toBe(0);
            await vi.waitFor(() => expect(told).toEqual([[id, 'stale']]));
            expect(handled).toEqual([]);
            // the recoverable status: UNANSWERED, kept with its event for a while
            expect(await stateOf(id)).toBe('u');
            expect(JSON.parse((await client.get(`matrix:inbox:${id}`)) as string).event.content.body).toBe('Pause the job');
            expect(await client.ttl(`matrix:inbox:${id}`)).toBeGreaterThan(100);
            expect(await client.zScore(INBOX_KEY, id)).toBeNull();
            // once: a later scan says nothing, and a redelivery of the event is not handled
            expect(await router.recover()).toBe(0);
            expect((await put('t2', say(room, id, 'Pause the job'))).status).toBe(200);
            await pause(150);
            expect(handled).toEqual([]);
            expect(told).toHaveLength(1);
        });

        it('an entry whose state or event lapsed (an older server kept it with an expiry) is reported as closed, never dropped in silence, and holds up no later event of its room', async () => {
            quiet();
            const room = roomOf('lapsed');
            const [noState, noEvent, later] = [fresh('no-state'), fresh('no-event'), fresh('after-lapsed')];
            const dead = inboxOn({ staleMs: 60 });
            await ((await dead.take(noState, say(room, noState, 'one'))) as InboxEntry).admit();
            await ((await dead.take(noEvent, say(room, noEvent, 'two'))) as InboxEntry).admit();
            await client.del(`matrix:event:${noState}`);
            await client.del(`matrix:inbox:${noEvent}`);
            await pause(150);
            const order: string[] = [];
            const told: Array<[string, string]> = [];
            const { router, put } = await serve(inboxOn({ staleMs: 60 }), async (event) => void order.push(event.event_id), { onGaveUp: async (event, why) => void told.push([event.event_id, why]) });
            expect(await router.recover()).toBe(0);
            // the one whose event is still there is told to the handler (the person hears of it); the one with no event left is logged loudly
            await vi.waitFor(() => expect(told).toEqual([[noState, 'lost']]));
            // the one whose event was kept left its room's order at once (its room is read from the event)
            expect(await client.zScore(`matrix:room-order:${room}`, noState)).toBeNull();
            expect(await stateOf(noEvent)).toBe('u');
            expect(await client.zScore(INBOX_KEY, noState)).toBeNull();
            expect(await client.zScore(INBOX_KEY, noEvent)).toBeNull();
            // the room is not held by either
            expect((await put('t3', say(room, later, 'three'))).status).toBe(200);
            await vi.waitFor(() => expect(order).toEqual([later]));
        });

        it('a completed record still expires (the dedupe memory is bounded)', async () => {
            const room = roomOf('expiry-done');
            const id = fresh('expiry-done');
            const inbox = inboxOn({ ttlSeconds: 1, staleMs: 60 });
            const taken = (await inbox.take(id, say(room, id, 'Hi'))) as InboxEntry;
            await taken.admit();
            await taken.done();
            expect(await stateOf(id)).toBe('d');
            await pause(1_300);
            expect(await stateOf(id)).toBeNull();
        });
    });

    describe('G2: an intake that never comes again does not hold its room for good', () => {
        it('a beating entry that was never admitted keeps its short life (the beat takes no expiry off) and lapses, and the room goes on', async () => {
            quiet();
            const room = roomOf('beat-unadmitted');
            const [id, later] = [fresh('beat-unadmitted'), fresh('after-unadmitted')];
            const inbox = inboxOn({ ttlSeconds: 1, beatEveryMs: 50, staleMs: 60_000 });
            const taken = (await inbox.take(id, say(room, id, 'Pause the job'))) as InboxEntry;
            // several beats while its transaction is still open
            await pause(300);
            for (const key of [`matrix:event:${id}`, `matrix:inbox:${id}`]) {
                const left = await client.ttl(key);
                expect(left).toBeGreaterThan(0);
                expect(left).toBeLessThanOrEqual(1);
            }
            // its transaction never comes again: it lapses while it still beats
            await pause(1_200);
            expect(await stateOf(id)).toBeNull();
            const order: string[] = [];
            const { put } = await serve(inboxOn({ staleMs: 60_000 }), async (event) => void order.push(event.event_id));
            expect((await put('t2', say(room, later, 'Resume the job'))).status).toBe(200);
            await vi.waitFor(() => expect(order).toEqual([later]));
            await taken.undo().catch(() => undefined);
        });
    });

    describe('G2: a paid-mark takeover closes quietly only on a proved answer (through the real bridge)', () => {
        const botId = '0b7c1d2e-1111-4222-8333-944455556666';
        const botUser = `@bot_${botId}:matrix.test`;
        const makeBridge = (room: string, reply: () => Promise<unknown>) => {
            const deps: any = {
                getBotConfig: vi.fn(async () => ({ botId, name: 'Guide', enabled: true, aiProviderRef: 'p' })),
                checkAccess: vi.fn(async () => ({ allowed: true, reason: null, user: { uuid: 'uuid-alice', name: 'Alice', isGuest: false } })),
                reply: vi.fn(reply),
                rooms: { rememberDmRoom: vi.fn(async () => undefined), getDmRoomBot: vi.fn(async (r: string) => (r === room ? botId : null)), forgetDmRoom: vi.fn(async () => undefined) },
            };
            let sent = 0;
            const client: any = {
                ensureRegistered: vi.fn(async () => undefined),
                setDisplayName: vi.fn(async () => undefined),
                getDisplayName: vi.fn(async () => 'Guide'),
                joinRoom: vi.fn(async () => undefined),
                leaveRoom: vi.fn(async () => undefined),
                sendText: vi.fn(async () => `$reply-${++sent}`),
                sendMessage: vi.fn(async () => `$msg-${++sent}`),
                setTyping: vi.fn(async () => undefined),
                getJoinedMembers: vi.fn(async () => ['@alice:matrix.test', botUser]),
                getRecentMessages: vi.fn(async () => []),
            };
            return { bridge: new MatrixDmBridge(config, client as never, deps), deps, client };
        };
        const notesIn = (client: any, state = 'unsure') => client.sendMessage.mock.calls.filter((call: any[]) => call[2]?.[BOT_STATUS_KEY]?.state === state).length;
        /** A server that answers (or not) and then goes away before it can mark the event done: its entries never end and never beat again. */
        const dyingInbox = (): EventInbox => {
            const real = inboxOn({ owner: 'dies', staleMs: 60 });
            return {
                owner: real.owner,
                recover: () => real.recover(),
                take: async (id, event) => {
                    const entry = await real.take(id, event);
                    if (!entry || entry === 'busy') return entry;
                    return { ...entry, admit: entry.admit, paid: entry.paid, answered: entry.answered, turn: entry.turn, done: () => new Promise<void>(() => undefined) } as InboxEntry;
                },
            };
        };

        it('the answer got out and its link was kept: the server that takes the entry over closes it quietly (reported, no note), and never runs it again', async () => {
            quiet();
            const room = roomOf('answered');
            const id = fresh('answered');
            const first = makeBridge(room, async () => ({ text: 'Paused.', media: [] }));
            const A = await serve(dyingInbox(), (event, hooks) => first.bridge.onEvent(event, hooks));
            expect((await A.put('t1', say(room, id, 'Pause the job'))).status).toBe(200);
            await vi.waitFor(() => expect(first.client.sendText).toHaveBeenCalled());
            await vi.waitFor(async () => expect(await client.get(`matrix:inbox-answer:${id}`)).toMatch(/^\$reply-/));
            await pause(150);
            const second = makeBridge(room, async () => ({ text: 'Paused again.', media: [] }));
            const B = await serve(inboxOn({ staleMs: 60 }), (event, hooks) => second.bridge.onEvent(event, hooks), { onGaveUp: (event, why) => second.bridge.onGaveUp(event, why) });
            expect(await B.router.recover()).toBe(0);
            await vi.waitFor(async () => expect(await stateOf(id)).toBe('d'));
            await pause(100);
            expect(second.deps.reply).not.toHaveBeenCalled();
            expect(notesIn(second.client)).toBe(0);
            expect(notesIn(second.client, 'trouble')).toBe(0);
            expect(first.deps.reply).toHaveBeenCalledTimes(1);
        });

        it('paid work began and no answer is proved (the turn never finished): one "Cut off" note (never "send it again"), closed as unanswered, never run again', async () => {
            quiet();
            const room = roomOf('unproved');
            const id = fresh('unproved');
            // the turn began (paid) and the server went away in the middle of it. The reply is held through the recovery, and let go in the teardown, which then waits for that first
            // handler to end (its typing refresh stops with it: CodeRabbit on 68379005, finding 19)
            let failReply!: (error: Error) => void;
            const first = makeBridge(room, () => new Promise((_, reject) => (failReply = reject)));
            let firstRun: Promise<void> | undefined;
            const A = await serve(dyingInbox(), (event, hooks) => (firstRun = first.bridge.onEvent(event, hooks)));
            cleanups.push(async () => {
                failReply?.(new Error('the test is over'));
                await firstRun;
            });
            expect((await A.put('t1', say(room, id, 'Pause the job'))).status).toBe(200);
            await vi.waitFor(async () => expect(await stateOf(id)).toMatch(/\|\$$/));
            await pause(150);
            const second = makeBridge(room, async () => ({ text: 'Paused.', media: [] }));
            const B = await serve(inboxOn({ staleMs: 60 }), (event, hooks) => second.bridge.onEvent(event, hooks), { onGaveUp: (event, why) => second.bridge.onGaveUp(event, why) });
            expect(await B.router.recover()).toBe(0);
            await vi.waitFor(() => expect(notesIn(second.client)).toBe(1));
            // Fable's words: the person is asked to check, not to send it again (a resent message would be a second paid turn)
            const note = second.client.sendMessage.mock.calls.find((call: any[]) => call[2]?.[BOT_STATUS_KEY]?.state === 'unsure')[2];
            expect(note.body).toBe('Guide was cut off while answering, so some of the work may already be done. Nothing is sent again by itself. Check first, and send it again only if you still need it.');
            expect(note[BOT_STATUS_KEY].title).toBe('Cut off');
            expect(notesIn(second.client, 'trouble')).toBe(0);
            expect(await stateOf(id)).toBe('u');
            // the closed entry left its room's order at once (the scan read its room from the kept event)
            expect(await client.zScore(`matrix:room-order:${room}`, id)).toBeNull();
            expect(second.deps.reply).not.toHaveBeenCalled();
            // once: the next scan says nothing more
            expect(await B.router.recover()).toBe(0);
            await pause(100);
            expect(notesIn(second.client)).toBe(1);
        });

        it('a link that could not be kept (the store refused it) counts as no answer: the person gets the "Cut off" note', async () => {
            quiet();
            const room = roomOf('unsure');
            const id = fresh('unsure');
            const first = makeBridge(room, async () => ({ text: 'Paused.', media: [] }));
            const real = dyingInbox();
            const noLink: EventInbox = {
                owner: real.owner,
                recover: () => real.recover(),
                take: async (eventId, event) => {
                    const entry = await real.take(eventId, event);
                    if (!entry || entry === 'busy') return entry;
                    // the store did not take the link: `answered` never throws, and nothing is kept
                    return { ...entry, answered: async () => undefined } as InboxEntry;
                },
            };
            const A = await serve(noLink, (event, hooks) => first.bridge.onEvent(event, hooks));
            expect((await A.put('t1', say(room, id, 'Pause the job'))).status).toBe(200);
            await vi.waitFor(() => expect(first.client.sendText).toHaveBeenCalled());
            await pause(150);
            expect(await client.get(`matrix:inbox-answer:${id}`)).toBeNull();
            const second = makeBridge(room, async () => ({ text: 'x', media: [] }));
            const B = await serve(inboxOn({ staleMs: 60 }), (event, hooks) => second.bridge.onEvent(event, hooks), { onGaveUp: (event, why) => second.bridge.onGaveUp(event, why) });
            expect(await B.router.recover()).toBe(0);
            await vi.waitFor(() => expect(notesIn(second.client)).toBe(1));
            expect(second.deps.reply).not.toHaveBeenCalled();
        });

        it('a state that lapsed (lost: whether it was paid is unknown) gets the "Cut off" note, never "trouble"; one that ran out of tries gets "trouble"', async () => {
            quiet();
            const room = roomOf('lost-note');
            const [lost, spent] = [fresh('lost-note'), fresh('spent-note')];
            const dead = inboxOn({ owner: 'dies', staleMs: 60 });
            await ((await dead.take(lost, say(room, lost, 'Pause the job'))) as InboxEntry).admit();
            await client.del(`matrix:event:${lost}`);
            await pause(150);
            const second = makeBridge(room, async () => ({ text: 'x', media: [] }));
            const B = await serve(inboxOn({ staleMs: 60 }), (event, hooks) => second.bridge.onEvent(event, hooks), { onGaveUp: (event, why) => second.bridge.onGaveUp(event, why) });
            expect(await B.router.recover()).toBe(0);
            await vi.waitFor(() => expect(notesIn(second.client)).toBe(1));
            expect(notesIn(second.client, 'trouble')).toBe(0);
            expect(await stateOf(lost)).toBe('u');
            expect(second.deps.reply).not.toHaveBeenCalled();
            // the other side of the line: nothing paid ran (it only ran out of tries), so the person is asked to send it again
            const otherRoom = roomOf('spent-note');
            const third = makeBridge(otherRoom, async () => ({ text: 'x', media: [] }));
            const C = await serve(inboxOn({ staleMs: 60, maxTries: 1 }), async () => {
                throw new Error('fails');
            }, { onGaveUp: (event, why) => third.bridge.onGaveUp(event, why) });
            expect((await C.put('t9', say(otherRoom, spent, 'Pause the job'))).status).toBe(200);
            await vi.waitFor(() => expect(notesIn(third.client, 'trouble')).toBe(1));
            expect(notesIn(third.client)).toBe(0);
        });
    });

    describe('A2: a start key keeps its issue time on every try (the time the inbox kept, never this try\'s clock)', () => {
        it('an event with no origin_server_ts: every try, here and at another server, is given the one time the inbox kept with it', async () => {
            quiet();
            const room = roomOf('arrived');
            const id = fresh('arrived');
            const seen: Array<number | undefined> = [];
            const { put } = await serve(inboxOn({ staleMs: 60 }), async (event, hooks) => {
                seen.push(hooks?.arrived);
                throw new Error('fails before anything was paid for');
            });
            const bare = { ...say(room, id, 'Start the job') } as MatrixEvent & { origin_server_ts?: number };
            delete bare.origin_server_ts;
            expect((await put('t1', bare)).status).toBe(200);
            await vi.waitFor(async () => expect(await stateOf(id)).toBe('p|-|1'));
            // The time kept with the event, read once the give-back is confirmed and before anything can end the entry (CodeRabbit on 68379005, finding 20)
            const kept = JSON.parse((await client.get(`matrix:inbox:${id}`)) ?? 'null') as { arrived?: unknown } | null;
            expect(typeof kept?.arrived).toBe('number');
            const expected = Math.floor((kept!.arrived as number) / 1000);
            await pause(120);
            const B = await serve(inboxOn({ staleMs: 60 }), async (event, hooks) => void seen.push(hooks?.arrived));
            expect(await B.router.recover()).toBe(1);
            await vi.waitFor(() => expect(seen).toHaveLength(2));
            expect(seen).toEqual([expected, expected]);
        });

        it('the bridge gives the turn the event\'s own time, else the kept time (never the clock), as the moment of consent', async () => {
            const room = roomOf('consent');
            const botId = '0b7c1d2e-1111-4222-8333-944455556666';
            const botUser = `@bot_${botId}:matrix.test`;
            const deps: any = {
                getBotConfig: vi.fn(async () => ({ botId, name: 'Guide', enabled: true, aiProviderRef: 'p' })),
                checkAccess: vi.fn(async () => ({ allowed: true, reason: null, user: { uuid: 'uuid-alice', name: 'Alice', isGuest: false } })),
                reply: vi.fn(async () => ({ text: 'Started.', media: [] })),
                rooms: { rememberDmRoom: vi.fn(async () => undefined), getDmRoomBot: vi.fn(async (r: string) => (r === room ? botId : null)), forgetDmRoom: vi.fn(async () => undefined) },
            };
            let sent = 0;
            const matrix: any = {
                ensureRegistered: vi.fn(async () => undefined),
                setDisplayName: vi.fn(async () => undefined),
                getDisplayName: vi.fn(async () => 'Guide'),
                joinRoom: vi.fn(async () => undefined),
                leaveRoom: vi.fn(async () => undefined),
                sendText: vi.fn(async () => `$reply-${++sent}`),
                sendMessage: vi.fn(async () => `$msg-${++sent}`),
                setTyping: vi.fn(async () => undefined),
                getJoinedMembers: vi.fn(async () => ['@alice:matrix.test', botUser]),
                getRecentMessages: vi.fn(async () => []),
            };
            const bridge = new MatrixDmBridge(config, matrix as never, deps);
            const hooks = { paid: async () => undefined, durable: true, arrived: 1_234_567 };
            const bare = { ...say(room, fresh('consent-bare'), 'Start the job') } as MatrixEvent & { origin_server_ts?: number };
            delete bare.origin_server_ts;
            await bridge.onEvent(bare, hooks);
            await vi.waitFor(() => expect(deps.reply).toHaveBeenCalledTimes(1));
            expect(deps.reply.mock.calls[0][4].eventTs).toBe(1_234_567);
            const timed = say(room, fresh('consent-timed'), 'Start another');
            await bridge.onEvent(timed, hooks);
            await vi.waitFor(() => expect(deps.reply).toHaveBeenCalledTimes(2));
            expect(deps.reply.mock.calls[1][4].eventTs).toBe(timed.origin_server_ts);
        });
    });

    describe('CodeRabbit on 68379005, finding 6: an answer with no words is proved by its parts (through the real bridge)', () => {
        const botId = '0b7c1d2e-1111-4222-8333-944455556666';
        const botUser = `@bot_${botId}:matrix.test`;
        const card = { id: 'art-1', title: 'Trip plan', kind: 'page', version: 2 };
        const bridgeFor = (room: string, reply: unknown, sendMessage: (content: Record<string, unknown>) => Promise<unknown>) => {
            const deps: any = {
                getBotConfig: vi.fn(async () => ({ botId, name: 'Guide', enabled: true, aiProviderRef: 'p' })),
                checkAccess: vi.fn(async () => ({ allowed: true, reason: null, user: { uuid: 'uuid-alice', name: 'Alice', isGuest: false } })),
                reply: vi.fn(async () => reply),
                rooms: { rememberDmRoom: vi.fn(async () => undefined), getDmRoomBot: vi.fn(async (r: string) => (r === room ? botId : null)), forgetDmRoom: vi.fn(async () => undefined) },
            };
            const matrix: any = {
                ensureRegistered: vi.fn(async () => undefined),
                setDisplayName: vi.fn(async () => undefined),
                getDisplayName: vi.fn(async () => 'Guide'),
                joinRoom: vi.fn(async () => undefined),
                leaveRoom: vi.fn(async () => undefined),
                sendText: vi.fn(async () => '$text'),
                sendMessage: vi.fn(async (_user: string, _room: string, content: Record<string, unknown>) => sendMessage(content)),
                setTyping: vi.fn(async () => undefined),
                getJoinedMembers: vi.fn(async () => ['@alice:matrix.test', botUser]),
                getRecentMessages: vi.fn(async () => []),
            };
            return new MatrixDmBridge(config, matrix as never, deps);
        };
        const run = async (bridge: MatrixDmBridge, room: string, what: string) => {
            const proofs: string[] = [];
            await bridge.onEvent(say(room, fresh(what), 'Make me the plan'), { paid: async () => undefined, durable: true, answered: async (id) => void proofs.push(id) });
            return proofs;
        };

        it('an answer that is only an artifact card is proved by the card Matrix took; one whose card did not get through is not', async () => {
            quiet();
            const room = roomOf('artifact-only');
            let n = 0;
            const ok = bridgeFor(room, { text: '', media: [], artifacts: [card] }, async () => `$card-${++n}`);
            expect(await run(ok, room, 'artifact-only')).toEqual(['$card-1']);
            const failing = bridgeFor(room, { text: '', media: [], artifacts: [card, { ...card, id: 'art-2' }] }, async (content) => {
                if ((content as { body?: string }).body?.startsWith('Trip plan') && ++n === 3) throw new Error('Matrix refused it');
                return `$card-${n}`;
            });
            // one card of two did not get through: no proof (a server that takes the event over tells the person)
            expect(await run(failing, room, 'artifact-half')).toEqual([]);
        });

        it('an answer that is only a file is proved by the file\'s message; a file that failed proves nothing', async () => {
            quiet();
            const room = roomOf('media-only');
            const file = { url: 'https://files.example/plan.pdf', mediaType: 'file', name: 'plan.pdf' };
            const ok = bridgeFor(room, { text: '', media: [file], artifacts: [] }, async () => '$other');
            (ok as any).sendMedia = async (_user: string, _room: string, _item: unknown, onSent?: (id: string) => void) => {
                onSent?.('$file-1');
                return null;
            };
            expect(await run(ok, room, 'media-only')).toEqual(['$file-1']);
            const failing = bridgeFor(room, { text: '', media: [file], artifacts: [] }, async () => '$other');
            (failing as any).sendMedia = async () => {
                throw new Error('the upload failed');
            };
            expect(await run(failing, room, 'media-failed')).toEqual([]);
        });

        it('an answer with words is still proved by its words alone (the parts change nothing of that)', async () => {
            quiet();
            const room = roomOf('words-and-card');
            const bridge = bridgeFor(room, { text: 'Here it is.', media: [], artifacts: [card] }, async () => '$card');
            expect(await run(bridge, room, 'words-and-card')).toEqual(['$text']);
        });

        // CodeRabbit on ea88b4c1, finding 7
        it('an answer with words whose words Matrix gave no id for is not proved by a card that landed', async () => {
            quiet();
            const room = roomOf('words-unconfirmed');
            const bridge = bridgeFor(room, { text: 'Here it is.', media: [], artifacts: [card] }, async () => '$card');
            (bridge as any).client.sendText = vi.fn(async () => undefined);
            expect(await run(bridge, room, 'words-unconfirmed')).toEqual([]);
        });

        // CodeRabbit on ea88b4c1, finding 8
        it('a file-only answer is proved the moment Matrix accepts the last file, before the copy on the uploader is kept', async () => {
            quiet();
            const room = roomOf('media-copy');
            const { FileParser } = await import('../services/FileParser');
            vi.spyOn(FileParser, 'validateUrl').mockResolvedValue(undefined as never);
            const axios = (await import('axios')).default;
            vi.spyOn(axios, 'get').mockResolvedValue({ data: Buffer.from('pdf'), headers: { 'content-type': 'application/pdf' } } as never);
            const files = [
                { url: 'https://files.example/one.pdf', mediaType: 'file', name: 'one.pdf' },
                { url: 'https://files.example/two.pdf', mediaType: 'file', name: 'two.pdf' },
            ];
            const mediaSent = vi.fn();
            let n = 0;
            const bridge = bridgeFor(room, { text: '', media: files, artifacts: [], mediaSent }, async () => `$file-${++n}`);
            (bridge as any).client.uploadMedia = vi.fn(async () => 'mxc://matrix.test/pdf');
            // the copy of the LAST file hangs (the first is kept at once)
            let keepLast!: (url: string) => void;
            const copies = [async () => 'https://uploader.test/one.pdf', () => new Promise<string>((resolve) => (keepLast = resolve))];
            (bridge as any).deps.uploadAttachment = vi.fn(() => copies.shift()!());
            const proofs: string[] = [];
            const answering = bridge.onEvent(say(room, fresh('media-copy'), 'Send me both'), { paid: async () => undefined, durable: true, answered: async (id) => void proofs.push(id) });
            await vi.waitFor(() => expect(keepLast).toBeDefined());
            // Matrix took both files: the proof is kept already, while the copy is still on its way
            await vi.waitFor(() => expect(proofs).toEqual(['$file-2']));
            expect(mediaSent).toHaveBeenCalledTimes(1);
            keepLast('https://uploader.test/two.pdf');
            await answering;
            // the copy still goes on the list, and the proof is kept once
            expect(mediaSent).toHaveBeenCalledTimes(2);
            expect(mediaSent.mock.calls[1][0]).toMatchObject({ url: 'https://uploader.test/two.pdf' });
            expect(proofs).toEqual(['$file-2']);
        });
    });

    describe('CodeRabbit on 68379005: the gate, recovery and shutdown (findings 4, 5, 7, 8, 9)', () => {
        const realEval = (script: string, o: unknown) => (client as never as { eval: (s: string, o: unknown) => Promise<unknown> }).eval(script, o);
        const isTurn = (script: string) => script.includes('local function go()');
        const isYield = (script: string) => script.includes("A wait that already gave this acquisition's try back");
        /** An inbox over the real store whose calls can be held: `hold` answers a promise to wait for (or nothing) for a script and its keys. */
        const heldInbox = (hold: (script: string, keys: string[]) => Promise<unknown> | undefined, extra: Parameters<typeof createEventInbox>[1] = {}) =>
            tracked(
                createEventInbox(
                    () =>
                        ({
                            eval: async (script: string, o: { keys: string[] }) => {
                                await hold(script, o.keys);
                                return realEval(script, o);
                            },
                            zRangeByScore: (...args: unknown[]) => (client as never as { zRangeByScore: (...a: unknown[]) => Promise<string[]> }).zRangeByScore(...args),
                        }) as never,
                    { ttlSeconds: 60, beatEveryMs: 60_000, staleMs: 60, log: () => undefined, ...extra }
                )
            );
        const firstFails = (id: () => string) => {
            let failed = false;
            return async (event: MatrixEvent) => {
                if (event.event_id === id() && !failed) {
                    failed = true;
                    throw new Error('before paid work');
                }
            };
        };

        it('5: the shutdown deadline holds while the store stalls on handing a waiting event back', async () => {
            quiet();
            const room = roomOf('settle-stall');
            const [first, second] = [fresh('stall-first'), fresh('stall-second')];
            let unstall!: () => void;
            const stalled = new Promise<void>((resolve) => (unstall = resolve));
            cleanups.push(() => unstall());
            const A = await serve(
                heldInbox((script) => (isYield(script) ? stalled : undefined)),
                firstFails(() => first)
            );
            expect((await A.put('t1', say(room, first, 'one'), say(room, second, 'two'))).status).toBe(200);
            await vi.waitFor(async () => expect(await stateOf(first)).toBe('p|-|1'));
            await vi.waitFor(async () => expect(await stateOf(second)).toMatch(/^p\|[^-|][^|]*\|0$/));
            const started = Date.now();
            const late = setTimeout(() => unstall(), 1_500);
            expect(await A.router.settle(50)).toBe(false);
            clearTimeout(late);
            expect(Date.now() - started).toBeLessThan(1_000);
        });

        it('4: an event that meets the gate after the shutdown began is handed back before the shutdown says it is done', async () => {
            quiet();
            const room = roomOf('settle-late');
            const [first, second] = [fresh('late-first'), fresh('late-second')];
            let open!: () => void;
            const gate = new Promise<void>((resolve) => (open = resolve));
            cleanups.push(() => open());
            const A = await serve(
                heldInbox((script, keys) => {
                    // the second's look at the gate is held until the shutdown has begun; the hand-off itself is slow
                    if (isTurn(script) && keys[0] === `matrix:event:${second}`) return gate;
                    if (isYield(script)) return pause(200);
                    return undefined;
                }),
                firstFails(() => first)
            );
            expect((await A.put('t1', say(room, first, 'one'), say(room, second, 'two'))).status).toBe(200);
            await vi.waitFor(async () => expect(await stateOf(first)).toBe('p|-|1'));
            const settling = A.router.settle(3_000);
            await pause(50);
            open();
            expect(await settling).toBe(true);
            // handed back already: no owner, and the try it never had is not counted
            expect(await stateOf(second)).toBe('p|-|0');
        });

        it('a waiting event whose look at the gate failed (the store did not answer) is handed back at shutdown with its untried try given back too', async () => {
            quiet();
            const room = roomOf('settle-unsure');
            const [first, second] = [fresh('unsure-first'), fresh('unsure-second')];
            const A = await serve(
                heldInbox((script, keys) => (isTurn(script) && keys[0] === `matrix:event:${second}` ? Promise.reject(new Error('store hiccup')) : undefined)),
                firstFails(() => first)
            );
            expect((await A.put('t1', say(room, first, 'one'), say(room, second, 'two'))).status).toBe(200);
            await vi.waitFor(async () => expect(await stateOf(first)).toBe('p|-|1'));
            await pause(100);
            // it waits with the try of its take still on it (no answer from the gate gave it back)
            expect(await stateOf(second)).toMatch(/^p\|[^-|][^|]*\|1$/);
            expect(await A.router.settle(2_000)).toBe(true);
            expect(await stateOf(second)).toBe('p|-|0');
        });

        it('7: an entry a scan took out of the index before it was admitted is back in it once admitted, so a later scan finds it', async () => {
            quiet();
            const room = roomOf('admit-index');
            const id = fresh('admit-index');
            const owner = inboxOn({ staleMs: 60 });
            const taken = (await owner.take(id, say(room, id, 'Pause the job'))) as InboxEntry;
            await pause(120);
            // the owner went quiet before its transaction was kept: a scan does not hand it out, and takes it out of the index
            expect(await inboxOn({ staleMs: 60 }).recover()).toHaveLength(0);
            expect(await client.zScore(INBOX_KEY, id)).toBeNull();
            // the owner was only slow: it admits (its transaction is answered 200), and the entry is in the index again at once
            await taken.admit();
            expect(await client.zScore(INBOX_KEY, id)).not.toBeNull();
            // it then stops before any beat: the next scan finds it
            await pause(120);
            const found = await inboxOn({ staleMs: 60 }).recover();
            expect(found.map((one) => (one.event as MatrixEvent).event_id)).toEqual([id]);
        });

        it('8: a later event that waits through several lost owners keeps its tries, and runs once the earlier one is done', async () => {
            quiet();
            const room = roomOf('wait-tries');
            const [first, second] = [fresh('long-first'), fresh('waits-long')];
            // the first runs long on a live server (it beats)
            let finishFirst!: () => void;
            const A = await serve(inboxOn({ staleMs: 60, beatEveryMs: 20 }), (event) =>
                event.event_id === first ? new Promise<void>((resolve) => (finishFirst = resolve)) : Promise.resolve()
            );
            cleanups.push(() => finishFirst?.());
            expect((await A.put('t1', say(room, first, 'one'))).status).toBe(200);
            await vi.waitFor(() => expect(finishFirst).toBeDefined());
            // the second reaches a server that never beats: it waits there, and each scan finds its owner gone and takes it over, and it waits again
            const told: Array<[string, string]> = [];
            const handled: string[] = [];
            const onGaveUp = async (event: MatrixEvent, why: string) => void told.push([event.event_id, why]);
            const X = await serve(inboxOn({ staleMs: 60, maxTries: 3 }), async (event) => void handled.push(event.event_id), { onGaveUp });
            expect((await X.put('t2', say(room, second, 'two'))).status).toBe(200);
            await vi.waitFor(async () => expect(await stateOf(second)).toMatch(/^p\|[^-|][^|]*\|0$/));
            let last = X;
            for (let lost = 0; lost < 4; lost++) {
                await pause(120);
                const next = await serve(inboxOn({ staleMs: 60, maxTries: 3 }), async (event) => void handled.push(event.event_id), { onGaveUp });
                expect(await next.router.recover()).toBe(1);
                // taken over, and waiting again with no try used
                await vi.waitFor(async () => expect(await stateOf(second)).toMatch(/^p\|[^-|][^|]*\|0$/));
                last = next;
            }
            expect(told).toEqual([]);
            expect(handled).toEqual([]);
            finishFirst();
            await vi.waitFor(() => expect(handled).toEqual([second]));
            await vi.waitFor(async () => expect(await stateOf(second)).toBe('d'));
            expect(told).toEqual([]);
            void last;
        });

        it('9: a live event that waited past the age limit is closed as stale when its turn comes (never run late); one that reaches the front in time runs', async () => {
            quiet();
            const room = roomOf('wait-old');
            const [first, second, third] = [fresh('old-first'), fresh('waits-old'), fresh('waits-young')];
            let finishFirst!: () => void;
            const A = await serve(inboxOn({ staleMs: 60_000, beatEveryMs: 20 }), (event) =>
                event.event_id === first ? new Promise<void>((resolve) => (finishFirst = resolve)) : Promise.resolve()
            );
            cleanups.push(() => finishFirst?.());
            expect((await A.put('t1', say(room, first, 'one'))).status).toBe(200);
            await vi.waitFor(() => expect(finishFirst).toBeDefined());
            const told: Array<[string, string]> = [];
            const handled: string[] = [];
            // its owner is alive (it beats) the whole time: no take-over ever looks at its age
            const X = await serve(inboxOn({ staleMs: 60_000, beatEveryMs: 20, unfinishedMaxMs: 300 }), async (event) => void handled.push(event.event_id), {
                onGaveUp: async (event, why) => void told.push([event.event_id, why]),
            });
            expect((await X.put('t2', say(room, second, 'two'))).status).toBe(200);
            await vi.waitFor(async () => expect(await stateOf(second)).toMatch(/^p\|[^-|][^|]*\|0$/));
            await pause(400);
            finishFirst();
            await vi.waitFor(() => expect(told).toEqual([[second, 'stale']]));
            expect(handled).toEqual([]);
            expect(await stateOf(second)).toBe('u');
            expect(await client.zScore(`matrix:room-order:${room}`, second)).toBeNull();
            // the recoverable status keeps the event
            expect(await client.get(`matrix:inbox:${second}`)).toContain(second);
            // the room goes on: a later event that reaches the front in time runs
            expect((await X.put('t3', say(room, third, 'three'))).status).toBe(200);
            await vi.waitFor(() => expect(handled).toEqual([third]));
        });
    });

    describe('CodeRabbit on ea88b4c1: a hand-off at shutdown, and a stale closure whose answer was lost (findings 5 and 9)', () => {
        const realEval = (script: string, o: unknown) => (client as never as { eval: (s: string, o: unknown) => Promise<unknown> }).eval(script, o);
        const isTurn = (script: string) => script.includes('local function go()');
        const isYield = (script: string) => script.includes("A wait that already gave this acquisition's try back");
        /** An inbox over the real store whose every call goes through `around`: it can fail a call before it is written, or write it and lose the answer. */
        const wrapped = (around: (script: string, keys: string[], run: () => Promise<unknown>) => Promise<unknown>, extra: Parameters<typeof createEventInbox>[1] = {}) =>
            tracked(
                createEventInbox(
                    () =>
                        ({
                            eval: (script: string, o: { keys: string[] }) => around(script, o.keys, () => realEval(script, o)),
                            zRangeByScore: (...args: unknown[]) => (client as never as { zRangeByScore: (...a: unknown[]) => Promise<string[]> }).zRangeByScore(...args),
                        }) as never,
                    { ttlSeconds: 60, beatEveryMs: 60_000, staleMs: 60_000, log: () => undefined, ...extra }
                )
            );
        const firstFails = (id: () => string) => {
            let failed = false;
            return async (event: MatrixEvent) => {
                if (event.event_id === id() && !failed) {
                    failed = true;
                    throw new Error('before paid work');
                }
            };
        };
        /** Two events of a room: the first fails before paid work (given back), so the second waits behind it on this server. */
        const waitingPair = async (what: string, around: Parameters<typeof wrapped>[0]) => {
            const room = roomOf(what);
            const [first, second] = [fresh(`${what}-first`), fresh(`${what}-second`)];
            const A = await serve(wrapped(around), firstFails(() => first));
            expect((await A.put('t1', say(room, first, 'one'), say(room, second, 'two'))).status).toBe(200);
            await vi.waitFor(async () => expect(await stateOf(first)).toBe('p|-|1'));
            await vi.waitFor(async () => expect(await stateOf(second)).toMatch(/^p\|[^-|][^|]*\|0$/));
            return { A, first, second };
        };

        it('5: a hand-off the store refuses every time (nothing written) is not reported as drained: settle says false within its deadline, and the entry is still the old owner\'s', async () => {
            quiet();
            const { A, second } = await waitingPair('yield-refused', (script, _keys, run) => (isYield(script) ? Promise.reject(new Error('store down')) : run()));
            const started = Date.now();
            expect(await A.router.settle(2_000)).toBe(false);
            expect(Date.now() - started).toBeLessThan(1_500);
            expect(await stateOf(second)).toMatch(/^p\|[^-|][^|]*\|0$/);
        });

        it('5: a hand-off refused once and then taken is confirmed: settle says true, and the entry is given back with no try spent', async () => {
            quiet();
            let refused = 0;
            const { A, second } = await waitingPair('yield-once', (script, _keys, run) => (isYield(script) && refused++ === 0 ? Promise.reject(new Error('store hiccup')) : run()));
            expect(await A.router.settle(2_000)).toBe(true);
            expect(refused).toBe(2);
            expect(await stateOf(second)).toBe('p|-|0');
        });

        it('5: a hand-off the store wrote but whose answer was lost is confirmed by the next call (no longer this acquisition\'s), and its try is not given back twice', async () => {
            quiet();
            let lost = 0;
            const { A, second } = await waitingPair('yield-lost', async (script, _keys, run) => {
                const answer = await run();
                if (isYield(script) && lost++ === 0) throw new Error('the answer was lost');
                return answer;
            });
            expect(await A.router.settle(2_000)).toBe(true);
            expect(lost).toBe(2);
            expect(await stateOf(second)).toBe('p|-|0');
        });

        /** The first runs long on A; the second waits on X with a short age limit, and X's look that closes it as stale writes but loses its answer (and, when `refuseAfter`, every look after it fails before writing). */
        const staleLost = async (what: string, refuseAfter: boolean) => {
            const room = roomOf(what);
            const [first, second] = [fresh(`${what}-first`), fresh(`${what}-second`)];
            let finishFirst!: () => void;
            const A = await serve(inboxOn({ staleMs: 60_000, beatEveryMs: 20 }), (event) => (event.event_id === first ? new Promise<void>((resolve) => (finishFirst = resolve)) : Promise.resolve()));
            cleanups.push(() => finishFirst?.());
            expect((await A.put('t1', say(room, first, 'one'))).status).toBe(200);
            await vi.waitFor(() => expect(finishFirst).toBeDefined());
            const told: Array<[string, string]> = [];
            const handled: string[] = [];
            let closedLost = false;
            const X = await serve(
                wrapped(
                    async (script, keys, run) => {
                        const mine = isTurn(script) && keys[0] === `matrix:event:${second}`;
                        if (mine && closedLost && refuseAfter) throw new Error('store down');
                        const answer = await run();
                        if (mine && !closedLost && String(answer) === '3') {
                            closedLost = true;
                            throw new Error('the answer was lost');
                        }
                        return answer;
                    },
                    { beatEveryMs: 20, unfinishedMaxMs: 300 }
                ),
                async (event) => void handled.push(event.event_id),
                { onGaveUp: async (event, why) => void told.push([event.event_id, why]) }
            );
            expect((await X.put('t2', say(room, second, 'two'))).status).toBe(200);
            await vi.waitFor(async () => expect(await stateOf(second)).toMatch(/^p\|[^-|][^|]*\|0$/));
            await pause(400);
            finishFirst();
            await vi.waitFor(() => expect(closedLost).toBe(true));
            return { X, second, told, handled };
        };

        it('9: the same acquisition asks the gate again after the answer to its stale closure was lost, and is told stale again: the person is told once', async () => {
            quiet();
            const { second, told, handled } = await staleLost('stale-lost', false);
            await vi.waitFor(() => expect(told).toEqual([[second, 'stale']]));
            await pause(200);
            expect(told).toEqual([[second, 'stale']]);
            expect(handled).toEqual([]);
            expect(await stateOf(second)).toBe('u');
            // the recoverable status still keeps the event
            expect(await client.get(`matrix:inbox:${second}`)).toContain(second);
        });

        it('9: a server that shuts down before it could ask again learns it from the hand-off, and still tells the person', async () => {
            quiet();
            const { X, second, told, handled } = await staleLost('stale-lost-stop', true);
            await pause(100);
            expect(told).toEqual([]);
            expect(await X.router.settle(2_000)).toBe(true);
            expect(told).toEqual([[second, 'stale']]);
            expect(handled).toEqual([]);
            expect(await stateOf(second)).toBe('u');
        });
    });

    describe('G1: the gate and shutdown', () => {
        it('a member of the room order left by a server that ended it without taking it out (an older version) holds nothing up', async () => {
            quiet();
            const room = roomOf('leftover');
            const [old, later] = [fresh('old'), fresh('new')];
            const inbox = inboxOn({ staleMs: 60 });
            const taken = (await inbox.take(old, say(room, old, 'old'))) as InboxEntry;
            await taken.admit();
            // ended the way an older server ends it: done, and the room order not told
            await client.set(`matrix:event:${old}`, 'd', { EX: 60 });
            await client.zRem(INBOX_KEY, old);
            const order: string[] = [];
            const { put } = await serve(inboxOn({ staleMs: 60 }), async (event) => void order.push(event.event_id));
            expect((await put('t1', say(room, later, 'new'))).status).toBe(200);
            await vi.waitFor(() => expect(order).toEqual([later]));
            expect(await client.zScore(`matrix:room-order:${room}`, old)).toBeNull();
        });

        it('an event waiting at shutdown is given back without spending a try, and the next server runs the room in order', async () => {
            quiet();
            const room = roomOf('shutdown');
            const [first, second] = [fresh('first'), fresh('second')];
            let failed = false;
            const A = await serve(inboxOn({ staleMs: 60 }), async (event) => {
                if (event.event_id === first && !failed) {
                    failed = true;
                    throw new Error('before paid work');
                }
            });
            expect((await A.put('t1', say(room, first, 'one'), say(room, second, 'two'))).status).toBe(200);
            await vi.waitFor(async () => expect(await stateOf(first)).toBe('p|-|1'));
            await pause(100);
            // second waits, held by A, its try given back while it waits (a try counts only when it runs)
            expect(await stateOf(second)).toMatch(/^p\|[^-|][^|]*\|0$/);
            expect(await client.get(`matrix:inbox-waited:${second}`)).not.toBeNull();
            expect(await A.router.settle(2_000)).toBe(true);
            // given back: no owner, and the try it never had is not counted
            expect(await stateOf(second)).toBe('p|-|0');
            const order: string[] = [];
            const B = await serve(inboxOn({ staleMs: 60 }), async (event) => void order.push(String(event.content.body)));
            expect(await B.router.recover()).toBe(2);
            await vi.waitFor(() => expect(order).toEqual(['one', 'two']));
            await vi.waitFor(async () => expect(await stateOf(second)).toBe('d'));
        });
    });

    describe('CodeRabbit on 24dea75c, findings 1 to 3: an intake is never acknowledged and then undone', () => {
        const realEval = (script: string, o: unknown) => (client as never as { eval: (s: string, o: unknown) => Promise<unknown> }).eval(script, o);
        const isAdmit = (script: string) => script.includes("redis.call('SET', KEYS[8], '1')");
        /** An inbox whose ADMIT of `which` does `how`: `lost` commits and loses the answer, `fails` neither commits nor answers, `zero` answers 0 without committing. */
        const flakyAdmit = (which: () => string | undefined, how: 'lost' | 'fails' | 'zero', owner: string) => {
            let once = true;
            return createEventInbox(
                () =>
                    ({
                        eval: async (script: string, o: { keys: string[] }) => {
                            if (once && isAdmit(script) && o.keys[0] === `matrix:event:${which()}`) {
                                once = false;
                                if (how === 'zero') return 0;
                                if (how === 'fails') throw new Error('store hiccup');
                                await realEval(script, o);
                                throw new Error('the answer was lost');
                            }
                            return realEval(script, o);
                        },
                        zRangeByScore: (...args: unknown[]) => (client as never as { zRangeByScore: (...a: unknown[]) => Promise<string[]> }).zRangeByScore(...args),
                    }) as never,
                { owner, ttlSeconds: 60, beatEveryMs: 60_000, staleMs: 60, log: () => undefined }
            );
        };

        it('1: both admits commit and the answer to one is lost: A answers 500 but deletes nothing and handles both, in order; the resend (at B) is answered 200 and handles nothing', async () => {
            quiet();
            const room = roomOf('cr1');
            const [e1, e2] = [fresh('cr1-a'), fresh('cr1-b')];
            const handledA: string[] = [];
            const handledB: string[] = [];
            const A = await serve(flakyAdmit(() => e2, 'lost', 'server-a'), async (event) => void handledA.push(event.event_id));
            const B = await serve(inboxOn({ owner: 'server-b', staleMs: 60 }), async (event) => void handledB.push(event.event_id));
            const txn = [say(room, e1, 'Pause the job'), say(room, e2, 'Resume the job')];
            expect((await A.put('t1', ...txn)).status).toBe(500);
            expect((await B.put('t1', ...txn)).status).toBe(200);
            await vi.waitFor(() => expect(handledA).toEqual([e1, e2]));
            await vi.waitFor(async () => expect([await stateOf(e1), await stateOf(e2)]).toEqual(['d', 'd']));
            await pause(150);
            expect(handledB).toEqual([]);
            expect(await B.router.recover()).toBe(0);
        });

        it('one admit fails before it committed, the other commits: the kept one is handled here but only after the other comes again with the resend, in the room\'s order', async () => {
            quiet();
            const room = roomOf('cr1b');
            const [e1, e2] = [fresh('cr1b-a'), fresh('cr1b-b')];
            const order: string[] = [];
            const A = await serve(flakyAdmit(() => e1, 'fails', 'server-a'), async (event) => void order.push(String(event.content.body)));
            const txn = [say(room, e1, 'Pause the job'), say(room, e2, 'Resume the job')];
            expect((await A.put('t1', ...txn)).status).toBe(500);
            await pause(200);
            // Resume was kept (its admit committed) and is held, waiting behind the Pause that Synapse sends again
            expect(order).toEqual([]);
            expect(await client.exists(`matrix:inbox-resend:${e1}`)).toBe(1);
            expect((await A.put('t1', ...txn)).status).toBe(200);
            await vi.waitFor(() => expect(order).toEqual(['Pause the job', 'Resume the job']));
        });

        it('3: an admit the store answers with 0 throws: Matrix is answered 500, nothing is handled, and the resend is handled once', async () => {
            quiet();
            const room = roomOf('cr3');
            const id = fresh('cr3');
            const handled: string[] = [];
            const A = await serve(flakyAdmit(() => id, 'zero', 'server-a'), async (event) => void handled.push(event.event_id));
            expect((await A.put('t1', say(room, id, 'Hi'))).status).toBe(500);
            await pause(100);
            expect(handled).toEqual([]);
            expect(await stateOf(id)).toBeNull();
            expect((await A.put('t1', say(room, id, 'Hi'))).status).toBe(200);
            await vi.waitFor(() => expect(handled).toEqual([id]));
        });

        it('recovery never hands out an entry that was not admitted (Synapse never had a 200 for it and sends it again)', async () => {
            quiet();
            const room = roomOf('not-admitted');
            const id = fresh('not-admitted');
            const quiet_ = inboxOn({ staleMs: 60 });
            await quiet_.take(id, say(room, id, 'Hi'));
            await pause(150);
            const found = await inboxOn({ staleMs: 60 }).recover();
            expect(found).toEqual([]);
            expect(found.closed).toEqual([]);
            // it lapses with the done records' time if nothing comes; the resend takes it afresh
            expect(await client.ttl(`matrix:event:${id}`)).toBeGreaterThan(0);
            const again = (await inboxOn({ staleMs: 60 }).take(id, say(room, id, 'Hi'))) as InboxEntry;
            expect(again).toBeTruthy();
            await again.admit();
            expect(await client.ttl(`matrix:event:${id}`)).toBe(-1);
            await again.done();
        });
    });
});
