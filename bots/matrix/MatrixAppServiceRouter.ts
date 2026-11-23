import express, { type Request, type Response, type NextFunction, type Router } from 'express';
import { timingSafeEqual } from 'crypto';
import type { MatrixAppServiceConfig } from './MatrixConfig';
import { BEAT_EVERY_MS, type ClosedWhy, type EventInbox, type InboxEntry } from './MatrixEventInbox';

/** A Matrix event as Synapse pushes it to an application service. */
export interface MatrixEvent {
    type: string;
    room_id: string;
    sender: string;
    event_id: string;
    state_key?: string;
    content: Record<string, any>;
    origin_server_ts?: number;
    unsigned?: Record<string, any>;
}

/** What the router gives the handler with an event. */
export interface EventHooks {
    /** Called before something the person pays for begins; throws when that could not be written down (nothing paid for may begin then). */
    paid: () => void | Promise<void>;
    /**
     * False when NOTHING keeps this event if the handler gives up on it: there is no inbox, or the shared store is not connected, so no other try and no other server will ever see it. The handler then
     * keeps it itself (in its own memory) rather than holding the room's chain for it. Absent or true: a durable entry holds it, which another try or another server takes up.
     */
    durable?: boolean;
    /**
     * The person's answer to this event is out, and Matrix gave it `replyId`: kept beside the durable entry as the proof that the person was answered, read by a server that takes the
     * event over after paid work began (GPT's seventh note G2). Never throws; absent when nothing keeps the event.
     */
    answered?: (replyId: string) => Promise<void>;
    /**
     * When the durable inbox took this event in (milliseconds), as kept with the event: the same on every try and at every server that takes it over, so a start key made for the event
     * keeps its issue time when the event carries no `origin_server_ts` (GPT's seventh note A2). Absent when nothing keeps the event.
     */
    arrived?: number;
}

export interface MatrixEventHandler {
    /**
     * Called once per pushed event, after Synapse already got its 200. Must not throw. `paid` is called by the handler as soon as it has begun something the person pays for (a model
     * turn, a computer start): before that, an event whose handling throws is given back for another try; after it, it is never handled again.
     */
    onEvent(event: MatrixEvent, hooks?: EventHooks): Promise<void>;
    /**
     * An event nothing will handle any more (see `ClosedWhy`): it ran out of tries, it waited more than a day (`stale`), its entry lapsed (`lost`), or work had begun when its owner went
     * away and it is never handed out again (`paid`: no answer is proved; `answered`: the answer is proved). Told so it is not silent: the handler reports it and lets the person know,
     * except for `answered`. Never throws.
     */
    onGaveUp?(event: MatrixEvent, why: ClosedWhy): Promise<void>;
    /** Synapse asks whether a Matrix ID in our namespace exists before someone can invite it. */
    userExists(userId: string): Promise<boolean>;
}

const RECENT_TXN_LIMIT = 1000;

export interface MatrixAppServiceRouter extends Router {
    /**
     * For shutdown: from now on, transactions are refused so Synapse sends them again to the next bot server, and this
     * waits for the events already taken in to be handled, at most `timeoutMs`. Resolves true when all of them were.
     */
    settle(timeoutMs: number): Promise<boolean>;
    /** Takes up the events whose server went away (the durable inbox), and handles them here. Answers how many it took. */
    recover(): Promise<number>;
}

function tokenMatches(presented: string | undefined, expected: string): boolean {
    if (!presented) return false;
    const a = Buffer.from(presented);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
}

/** An event of a transaction is held by another server's intake that has not finished: the transaction is not answered as kept. */
class IntakeBusy extends Error {
    constructor(readonly eventId: string) {
        super('Another server is still taking this event in');
        this.name = 'IntakeBusy';
    }
}

/**
 * The application service API Synapse calls (spec: /_matrix/app/v1). Mount it before the bot API's own body parser:
 * a transaction can be larger than the default 100 kB limit.
 */
export function createMatrixAppServiceRouter(
    config: MatrixAppServiceConfig,
    handler: MatrixEventHandler,
    options: {
        /**
         * The durable inbox: every event is KEPT in it before Matrix is answered, and the entry is marked done once it was handled, so an event whose server died is handled by another
         * one (`recover`) instead of being lost behind a marker. Without one, events are handled as they arrive and nothing is remembered.
         */
        inbox?: EventInbox;
        /** How soon an event waiting behind an earlier one of its room asks again (for the tests): `BEAT_EVERY_MS / 6`, and at once when this server ends an event of that room. */
        waitCheckMs?: number;
    } = {}
): MatrixAppServiceRouter {
    const router = express.Router();
    const recentTxnIds: string[] = [];
    const recentTxnSet = new Set<string>();
    const roomChains = new Map<string, Promise<void>>();
    /** The transactions being taken in right now, by id: what each answers is whether its events were all kept. */
    const pendingTxns = new Map<string, Promise<boolean>>();
    /**
     * Transactions are taken in one after another in this process (each is a few quick steps in the shared store): a transaction never finds an event held by another intake that is still
     * running and can still roll it back, so "already held" always means kept (or handled), and the same event in two transactions is taken in by whichever comes first.
     */
    let intakes: Promise<unknown> = Promise.resolve();
    /** The look for events another server left, while one is going on (one at a time). */
    let recovering: Promise<number> | null = null;
    let closing = false;
    const waitCheckMs = options.waitCheckMs ?? BEAT_EVERY_MS / 6;
    /**
     * The events waiting behind an earlier unfinished event of their room (GPT's seventh note G1), in the order they came, by room. They are OFF the room's chain while they wait: the earlier
     * event, when this server takes it up again, runs on that chain and is not stuck behind them. Every later event of the room meets the same gate, so none runs ahead of them.
     */
    const waiting = new Map<string, Array<{ event: MatrixEvent; entry: InboxEntry }>>();
    const waitTimers = new Map<string, NodeJS.Timeout>();

    const requireHomeserver = (req: Request, res: Response, next: NextFunction) => {
        const header = req.headers.authorization;
        const bearer = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : undefined;
        const legacy = typeof req.query.access_token === 'string' ? req.query.access_token : undefined;
        if (!tokenMatches(bearer ?? legacy, config.hsToken)) {
            res.status(403).json({ errcode: 'M_FORBIDDEN', error: 'Bad homeserver token' });
            return;
        }
        next();
    };

    const transactions = (req: Request, res: Response) => {
        if (closing) {
            // Synapse keeps a refused transaction and sends it again later, by then to the bot server that took over.
            res.status(503).json({ errcode: 'M_UNKNOWN', error: 'Shutting down' });
            return;
        }
        const txnId = req.params.txnId;
        // Seen and KEPT: acknowledged again. A transaction still being taken in is not acknowledged until it is: if its intake fails and is rolled back, a duplicate that was told 200 would
        // leave Matrix believing events were kept that were not
        if (recentTxnSet.has(txnId)) {
            res.json({});
            return;
        }
        const pending = pendingTxns.get(txnId);
        if (pending) {
            void pending.then((kept) => {
                if (res.headersSent) return;
                if (kept) res.json({});
                else res.status(500).json({ errcode: 'M_UNKNOWN', error: 'Could not take the transaction in' });
            });
            return;
        }
        const events: MatrixEvent[] = Array.isArray(req.body?.events) ? req.body.events : [];
        const intake = intakes.then(() => takeIn(events, res, txnId)).catch(() => false);
        intakes = intake;
        pendingTxns.set(txnId, intake);
        void intake.finally(() => {
            if (pendingTxns.get(txnId) === intake) pendingTxns.delete(txnId);
        });
    };

    /** A transaction whose events were all kept: a copy of it that comes later is answered at once and handled by no one. */
    const rememberTxn = (txnId: string): void => {
        recentTxnSet.add(txnId);
        recentTxnIds.push(txnId);
        if (recentTxnIds.length > RECENT_TXN_LIMIT) recentTxnSet.delete(recentTxnIds.shift()!);
    };

    /**
     * Keeps every event of the transaction in the inbox BEFORE Matrix is answered (one step in the shared store each: no model call, no wait for a reply), then answers and handles them.
     * An event the inbox already holds, or that was handled, is not handled again. A store that is connected but fails leaves Matrix unanswered with a 500, so it sends the transaction
     * again and nothing is lost; a store that is not connected at all is the fallback of before (handle it, remember nothing).
     */
    const takeIn = async (events: MatrixEvent[], res: Response, txnId: string): Promise<boolean> => {
        const mine: Array<{ event: MatrixEvent; entry?: InboxEntry }> = [];
        try {
            for (const event of events) {
                if (!options.inbox) {
                    mine.push({ event });
                    continue;
                }
                // eslint-disable-next-line no-await-in-loop
                const taken = await options.inbox.take(event.event_id, event);
                if (taken === false) continue;
                // Another server holds this event and the transaction it came in is still being taken in there: that intake can still fail and take it back out, and a duplicate answered as
                // kept would then leave Matrix believing an event was kept that is gone. Synapse is asked to send the transaction again, by when that intake is over (admitted: skipped; taken back: taken in here)
                if (taken === 'busy') throw new IntakeBusy(event.event_id);
                mine.push({ event, entry: taken });
            }
            // The transaction is kept whole: from now on a duplicate of its events (at any server) is skipped. Not answered before this. Every admit is over before anything is decided, so
            // none still lands after the events are taken back out
            const admits = await Promise.allSettled(mine.map((one) => one.entry?.admit?.()));
            const refused = admits.find((one): one is PromiseRejectedResult => one.status === 'rejected');
            if (refused) throw refused.reason;
        } catch (error) {
            if (error instanceof IntakeBusy) console.warn(`[MatrixAppService] Another server is still taking ${error.eventId} in; Synapse is asked to send the transaction again`);
            else console.error('[MatrixAppService] Could not keep a transaction in the shared store; Synapse is asked to send it again:', error instanceof Error ? error.message : error);
            // What was already kept is taken back out as if never taken: the transaction that comes again holds those events too, and takes them in afresh in their order. An entry that
            // turns out ADMITTED (its admit committed and only the answer was lost) is never taken out (CodeRabbit on 24dea75c, finding 1): a duplicate of it is already skipped, so it is
            // handled HERE, in its order, and the resend skips it
            const undone = await Promise.all(mine.map((one) => (one.entry ? one.entry.undo().catch(() => 'unsure' as const) : Promise.resolve('undone' as const))));
            if (!res.headersSent) res.status(500).json({ errcode: 'M_UNKNOWN', error: 'Could not take the transaction in' });
            mine.forEach((one, index) => {
                if (undone[index] === 'admitted') work(one.event, one.entry);
            });
            return false;
        }
        // Remembered BEFORE Matrix is answered: a copy that comes after the answer is a duplicate of events that are kept
        rememberTxn(txnId);
        // Answer at once: Synapse holds later transactions until this one returns, and a reply can take a while.
        res.json({});
        for (const one of mine) work(one.event, one.entry);
        return true;
    };

    /** The reports of events that will not be handled, while they are being made: shutdown waits for them (within its own limit), so a notice is not lost to an exit. */
    const reporting = new Set<Promise<void>>();
    /** An event that will not be handled: logged loudly and handed to the handler to report and to tell the person. */
    const reasons: Record<ClosedWhy, string> = {
        tries: 'it ran out of tries',
        paid: 'work had begun when its server went away, and no answer to the person is proved',
        answered: 'work had begun when its server went away; the person was answered',
        stale: 'it was taken in more than a day ago and is not run late',
        lost: 'its entry lapsed in the shared store',
    };
    const gaveUp = (event: MatrixEvent, why: ClosedWhy): Promise<void> => {
        const run = (async () => {
            const line = `[MatrixAppService] An event will not be handled again (${reasons[why]}): ${event?.event_id ?? 'unknown'} in ${event?.room_id ?? 'unknown'}`;
            if (why === 'answered') console.warn(line);
            else console.error(line);
            try {
                await handler.onGaveUp?.(event, why);
            } catch (error) {
                console.error('[MatrixAppService] Could not report an event that will not be handled:', error instanceof Error ? error.message : error);
            }
        })();
        reporting.add(run);
        void run.finally(() => reporting.delete(run));
        return run;
    };

    /** The events of a room that wait are asked again: at once (`now`, this server just ended an event of the room) or after the wait. */
    const askAgain = (room: string, now = false): void => {
        if (!waiting.has(room)) return;
        const timer = waitTimers.get(room);
        if (timer && !now) return;
        if (timer) clearTimeout(timer);
        const again = setTimeout(
            () => {
                waitTimers.delete(room);
                const queued = waiting.get(room);
                waiting.delete(room);
                // In the order they came: each meets the gate again on the room's chain
                for (const one of queued ?? []) work(one.event, one.entry);
            },
            now ? 0 : waitCheckMs
        );
        again.unref?.();
        waitTimers.set(room, again);
    };
    /** Waits behind an earlier event of its room: held (its entry beats), off the chain, asked again soon. At shutdown it is given back instead (it never ran: not a try). */
    const wait = (event: MatrixEvent, entry: InboxEntry): void => {
        if (closing) {
            void entry.yieldBack?.();
            return;
        }
        const queued = waiting.get(event.room_id) ?? [];
        queued.push({ event, entry });
        waiting.set(event.room_id, queued);
        askAgain(event.room_id);
    };

    /** Handles one event (its own room in order), and ends its inbox entry: done, or back for another try when nothing of it was paid for. */
    const work = (event: MatrixEvent, entry?: InboxEntry): void => {
        // Events in one room run in order; different rooms run side by side, so one slow reply holds up no one else.
        const previous = roomChains.get(event.room_id) ?? Promise.resolve();
        const next = previous.then(async () => {
            // The gate of the room (G1): an earlier event of this room still unfinished anywhere (given back for another try, or held by a server that went away) runs first. This one waits,
            // still held; a store that does not answer is not a yes
            if (entry?.turn) {
                const turn = await entry.turn().catch(() => 'wait' as const);
                if (turn === 'gone') return;
                if (turn === 'wait') {
                    wait(event, entry);
                    return;
                }
            }
            // Whatever comes of it, the events of the room that wait are asked again at once once it ended
            try {
                await handle(event, entry);
            } finally {
                askAgain(event.room_id, true);
            }
        });
        roomChains.set(event.room_id, next);
        void next.then(() => {
            if (roomChains.get(event.room_id) === next) roomChains.delete(event.room_id);
        });
    };

    const handle = async (event: MatrixEvent, entry?: InboxEntry): Promise<void> => {
        {
            let paid = false;
            try {
                await handler.onEvent(event, {
                    // Written down in the shared store BEFORE the paid work begins: a server that dies after this leaves an entry no other server hands out again
                    // It counts as paid only once it was written down: when that fails (another server holds the event now, or the store did not answer) it throws, nothing paid for begins,
                    // and the event goes back as one that nothing was paid for
                    paid: async () => {
                        await entry?.paid();
                        paid = true;
                    },
                    durable: entry !== undefined && entry.durable !== false,
                    ...(entry?.answered ? { answered: (replyId: string) => entry.answered!(replyId) } : {}),
                    ...(entry?.arrived === undefined ? {} : { arrived: entry.arrived }),
                });
            } catch (error) {
                console.error('[MatrixAppService] Event handling failed:', error);
                // Nothing of it was paid for: it goes back, and another try (here or at another server) answers the person. Once something was paid for it is never handled again
                if (!paid) {
                    // The last try: nobody takes it again, so it is said (loudly) and the person is told, never silence. With no inbox nothing gives it back at all
                    const result = entry ? await entry.release(() => void gaveUp(event, 'tries')).catch(() => 'unsure' as const) : ('closed' as const);
                    if (result === 'closed') await gaveUp(event, 'tries');
                    // The store did not answer: the give-back goes on after this chain has ended, and may turn out to be the last try (which is then said). A shutdown waits for it, as for any report
                    const retrying = result === 'unsure' ? entry?.givingBack?.() : undefined;
                    if (retrying) {
                        const wait = retrying.catch(() => undefined);
                        reporting.add(wait);
                        void wait.finally(() => reporting.delete(wait));
                    }
                    return;
                }
            }
            await entry?.done().catch(() => undefined);
        }
    };

    /**
     * Takes up the events another server left behind (its handler died with it): they are handled here, in the order they arrived for each room. Called on a timer by the bot server, and
     * by the tests. Never throws.
     */
    const scan = async (): Promise<number> => {
        const left = await options.inbox!.recover();
        // In the order the events arrived: every taken entry beat from the moment it was taken, so their scores are near each other and a tie sorts by event id, not by arrival. Events
        // that share one time keep the order they were taken in (the count the inbox kept with each)
        const sentAt = (one: { event: unknown }): number => {
            const at = (one.event as { origin_server_ts?: unknown } | null)?.origin_server_ts;
            return typeof at === 'number' && Number.isFinite(at) ? at : Number.MAX_SAFE_INTEGER;
        };
        const ordered = left.map((one, index) => ({ one, index })).sort((a, b) => sentAt(a.one) - sentAt(b.one) || (a.one.arrived ?? Number.MAX_SAFE_INTEGER) - (b.one.arrived ?? Number.MAX_SAFE_INTEGER) || a.index - b.index);
        for (const { one } of ordered) work(one.event as MatrixEvent, one.entry);
        // What the scan closed instead of handing out (work had begun, or no tries left) is said, not dropped in silence
        for (const closed of left.closed ?? []) {
            if (closed.event) void gaveUp(closed.event as MatrixEvent, closed.why);
            else console.error(`[MatrixAppService] An event will not be handled again (${closed.why}), and the store no longer held it: ${closed.eventId}`);
        }
        return left.length;
    };
    const recover = (): Promise<number> => {
        if (closing || !options.inbox) return Promise.resolve(0);
        // One look at a time: a store that is slow to answer is not asked again by every tick of the timer
        if (recovering) return recovering;
        const look = scan()
            .catch(() => 0)
            .finally(() => {
                if (recovering === look) recovering = null;
            });
        recovering = look;
        return look;
    };

    const userQuery = async (req: Request, res: Response) => {
        try {
            if (await handler.userExists(req.params.userId)) {
                res.json({});
                return;
            }
        } catch (error) {
            console.error('[MatrixAppService] User query failed:', error);
        }
        res.status(404).json({ errcode: 'M_NOT_FOUND', error: 'No such bot' });
    };

    const notFound = (_req: Request, res: Response) => {
        res.status(404).json({ errcode: 'M_NOT_FOUND', error: 'Not found' });
    };

    // The token comes first, so nobody else gets a body read.
    router.use(['/_matrix/app', '/transactions', '/users', '/rooms'], requireHomeserver, express.json({ limit: '10mb' }));
    router.put('/_matrix/app/v1/transactions/:txnId', transactions);
    router.get('/_matrix/app/v1/users/:userId', userQuery);
    router.get('/_matrix/app/v1/rooms/:alias', notFound);
    router.post('/_matrix/app/v1/ping', (_req, res) => {
        res.json({});
    });
    // Unprefixed paths from older homeservers
    router.put('/transactions/:txnId', transactions);
    router.get('/users/:userId', userQuery);
    router.get('/rooms/:alias', notFound);

    const settle = async (timeoutMs: number): Promise<boolean> => {
        closing = true;
        // What waits behind an earlier event never ran: given back now (not a try), so the next scan anywhere takes it up in its room's order
        const givingBack = [...waiting.values()].flat().map((one) => one.entry.yieldBack?.().catch(() => undefined));
        waiting.clear();
        for (const timer of waitTimers.values()) clearTimeout(timer);
        waitTimers.clear();
        await Promise.all(givingBack);
        let timer: NodeJS.Timeout | undefined;
        const timedOut = new Promise<false>((resolve) => (timer = setTimeout(() => resolve(false), timeoutMs)));
        // Nothing new is admitted now, but what already was can still add work: a transaction being taken in, and a look for left-behind events, hand their events to the room chains when they
        // finish. Both are waited for first, then the chains, so none of that work starts after the wait has ended
        const done = (async () => {
            await Promise.all([...pendingTxns.values(), recovering ?? Promise.resolve(0)].map((one) => one.catch(() => undefined)));
            for (;;) {
                // The chains, and the reports of events given up on (which a chain can start as it ends): both until none is left
                const work = [...roomChains.values(), ...reporting];
                if (work.length === 0) return true as const;
                // eslint-disable-next-line no-await-in-loop
                await Promise.all(work.map((one) => one.catch(() => undefined)));
                if (roomChains.size === 0 && reporting.size === 0) return true as const;
            }
        })();
        try {
            return await Promise.race([done, timedOut]);
        } finally {
            clearTimeout(timer);
        }
    };
    return Object.assign(router, { settle, recover });
}
