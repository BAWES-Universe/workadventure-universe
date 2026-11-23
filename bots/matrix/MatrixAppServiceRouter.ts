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

export interface MatrixEventHandler {
    /**
     * Called once per pushed event, after Synapse already got its 200. Must not throw. `paid` is called by the handler as soon as it has begun something the person pays for (a model
     * turn, a computer start): before that, an event whose handling throws is given back for another try; after it, it is never handled again.
     */
    onEvent(event: MatrixEvent, hooks?: { paid: () => void | Promise<void> }): Promise<void>;
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
        if (recentTxnSet.has(txnId)) {
            res.json({});
            return;
        }
        recentTxnSet.add(txnId);
        recentTxnIds.push(txnId);
        if (recentTxnIds.length > RECENT_TXN_LIMIT) {
            recentTxnSet.delete(recentTxnIds.shift()!);
        }
        const events: MatrixEvent[] = Array.isArray(req.body?.events) ? req.body.events : [];
        void takeIn(events, res, txnId);
    };

    /** Forgets a transaction that was refused, so the transaction Synapse sends again is taken in and not answered as one already seen (Opus G6R-1). */
    const forgetTxn = (txnId: string): void => {
        recentTxnSet.delete(txnId);
        const at = recentTxnIds.indexOf(txnId);
        if (at >= 0) recentTxnIds.splice(at, 1);
    };

    /**
     * Keeps every event of the transaction in the inbox BEFORE Matrix is answered (one step in the shared store each: no model call, no wait for a reply), then answers and handles them.
     * An event the inbox already holds, or that was handled, is not handled again. A store that is connected but fails leaves Matrix unanswered with a 500, so it sends the transaction
     * again and nothing is lost; a store that is not connected at all is the fallback of before (handle it, remember nothing).
     */
    const takeIn = async (events: MatrixEvent[], res: Response, txnId: string): Promise<void> => {
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
            // Before Matrix is told: its resend of the same transaction must be taken in, not answered 200 as a duplicate that took nothing
            forgetTxn(txnId);
            if (!res.headersSent) res.status(500).json({ errcode: 'M_UNKNOWN', error: 'Could not take the transaction in' });
            return;
        }
        // Answer at once: Synapse holds later transactions until this one returns, and a reply can take a while.
        res.json({});
        for (const one of mine) work(one.event, one.entry);
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
                    paid: async () => {
                        paid = true;
                        await entry?.paid();
                    },
                });
            } catch (error) {
                console.error('[MatrixAppService] Event handling failed:', error);
                // Nothing of it was paid for: it goes back, and another try (here or at another server) answers the person. Once something was paid for it is never handled again
                if (!paid) {
                    await entry?.release().catch(() => undefined);
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
    const recover = async (): Promise<number> => {
        if (closing || !options.inbox) return 0;
        const left = await options.inbox.recover();
        // In the order the events arrived: every taken entry beat from the moment it was taken, so their scores are near each other and a tie sorts by event id, not by arrival
        const arrived = (one: { event: unknown }): number => {
            const at = (one.event as { origin_server_ts?: unknown } | null)?.origin_server_ts;
            return typeof at === 'number' && Number.isFinite(at) ? at : Number.MAX_SAFE_INTEGER;
        };
        const ordered = left.map((one, index) => ({ one, index })).sort((a, b) => arrived(a.one) - arrived(b.one) || a.index - b.index);
        for (const { one } of ordered) work(one.event as MatrixEvent, one.entry);
        return left.length;
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
        // Chains only grow while transactions are taken in, and those are refused now, so this set is final.
        const done = Promise.all([...roomChains.values()]).then(() => true as const);
        try {
            return await Promise.race([done, timedOut]);
        } finally {
            clearTimeout(timer);
        }
    };
    return Object.assign(router, { settle, recover });
}
