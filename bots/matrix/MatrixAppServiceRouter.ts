import express, { type Request, type Response, type NextFunction, type Router } from 'express';
import { timingSafeEqual } from 'crypto';
import type { MatrixAppServiceConfig } from './MatrixConfig';
import type { EventInbox, InboxEntry } from './MatrixEventInbox';

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
}

export interface MatrixEventHandler {
    /**
     * Called once per pushed event, after Synapse already got its 200. Must not throw. `paid` is called by the handler as soon as it has begun something the person pays for (a model
     * turn, a computer start): before that, an event whose handling throws is given back for another try; after it, it is never handled again.
     */
    onEvent(event: MatrixEvent, hooks?: EventHooks): Promise<void>;
    /**
     * An event nothing will handle any more: it ran out of tries (`tries`), or work had begun when its owner went away and it is never handed out again (`paid`). Told so it is not silent: the
     * handler reports it and, for `tries`, lets the person know. Never throws.
     */
    onGaveUp?(event: MatrixEvent, why: 'tries' | 'paid'): Promise<void>;
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
                mine.push({ event, entry: taken });
            }
        } catch (error) {
            console.error('[MatrixAppService] Could not keep a transaction in the shared store; Synapse is asked to send it again:', error instanceof Error ? error.message : error);
            // What was already kept is taken back out as if never taken: the transaction that comes again holds those events too, and takes them in afresh in their order
            await Promise.all(mine.map((one) => one.entry?.undo().catch(() => undefined)));
            if (!res.headersSent) res.status(500).json({ errcode: 'M_UNKNOWN', error: 'Could not take the transaction in' });
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
    const gaveUp = (event: MatrixEvent, why: 'tries' | 'paid'): Promise<void> => {
        const run = (async () => {
            console.error(`[MatrixAppService] An event will not be handled again (${why === 'tries' ? 'it ran out of tries' : 'work had begun when its server went away'}): ${event?.event_id ?? 'unknown'} in ${event?.room_id ?? 'unknown'}`);
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

    /** Handles one event (its own room in order), and ends its inbox entry: done, or back for another try when nothing of it was paid for. */
    const work = (event: MatrixEvent, entry?: InboxEntry): void => {
        // Events in one room run in order; different rooms run side by side, so one slow reply holds up no one else.
        const previous = roomChains.get(event.room_id) ?? Promise.resolve();
        const next = previous.then(async () => {
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
                });
            } catch (error) {
                console.error('[MatrixAppService] Event handling failed:', error);
                // Nothing of it was paid for: it goes back, and another try (here or at another server) answers the person. Once something was paid for it is never handled again
                if (!paid) {
                    // The last try: nobody takes it again, so it is said (loudly) and the person is told, never silence. With no inbox nothing gives it back at all
                    const result = entry ? await entry.release(() => void gaveUp(event, 'tries')).catch(() => 'unsure' as const) : ('closed' as const);
                    if (result === 'closed') await gaveUp(event, 'tries');
                    return;
                }
            }
            await entry?.done().catch(() => undefined);
        });
        roomChains.set(event.room_id, next);
        void next.then(() => {
            if (roomChains.get(event.room_id) === next) roomChains.delete(event.room_id);
        });
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
