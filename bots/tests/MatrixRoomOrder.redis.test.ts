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
    afterEach(async () => {
        vi.restoreAllMocks();
        const keys = await client.keys('matrix:*');
        const mine = keys.filter((key) => used.some((id) => key.endsWith(id)) || rooms.some((room) => key.endsWith(room)));
        if (mine.length > 0) await client.del(mine);
        for (const id of used) await client.zRem(INBOX_KEY, id);
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
    const inboxOn = (extra: Parameters<typeof createEventInbox>[1] = {}) => createEventInbox(() => client as never, { ttlSeconds: 60, beatEveryMs: 60_000, ...extra });
    const serve = async (inbox: EventInbox, onEvent: MatrixEventHandler['onEvent'], extra: Partial<MatrixEventHandler> = {}) => {
        const router = createMatrixAppServiceRouter(config, { onEvent, userExists: async () => true, ...extra }, { inbox, waitCheckMs: 50 });
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
            // server A takes Pause in and never finishes it (as good as gone: it never beats again)
            const A = await serve(inboxOn({ owner: 'server-a', staleMs: 60 }), () => new Promise<void>(() => undefined));
            expect((await A.put('t1', say(room, pauseId, 'Pause the job'))).status).toBe(200);
            const order: string[] = [];
            const B = await serve(inboxOn({ owner: 'server-b', staleMs: 60 }), async (event) => void order.push(String(event.content.body)));
            expect((await B.put('t2', say(room, resumeId, 'Resume the job'), say(other, elsewhere, 'Hello'))).status).toBe(200);
            await vi.waitFor(() => expect(order).toContain('Hello'));
            await pause(150);
            expect(order).not.toContain('Resume the job');
            // B takes the stale Pause over: Pause first, then Resume
            await B.router.recover();
            await vi.waitFor(() => expect(order.filter((one) => one !== 'Hello')).toEqual(['Pause the job', 'Resume the job']));
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
            // the turn began (paid) and the server went away in the middle of it
            const first = makeBridge(room, () => new Promise(() => undefined));
            const A = await serve(dyingInbox(), (event, hooks) => first.bridge.onEvent(event, hooks));
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
            // second waits, held by A
            expect(await stateOf(second)).toMatch(/\|1$/);
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
