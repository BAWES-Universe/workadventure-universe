import express, { type Request, type Response, type NextFunction, type Router } from 'express';
import { timingSafeEqual } from 'crypto';
import type { MatrixAppServiceConfig } from './MatrixConfig';

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
    /** Called once per pushed event, after Synapse already got its 200. Must not throw. */
    onEvent(event: MatrixEvent): Promise<void>;
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
export function createMatrixAppServiceRouter(config: MatrixAppServiceConfig, handler: MatrixEventHandler): MatrixAppServiceRouter {
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
        // Answer at once: Synapse holds later transactions until this one returns, and a reply can take a while.
        res.json({});
        // Events in one room run in order; different rooms run side by side, so one slow reply holds up no one else.
        for (const event of events) {
            const previous = roomChains.get(event.room_id) ?? Promise.resolve();
            const next = previous.then(() =>
                handler.onEvent(event).catch((error) => console.error('[MatrixAppService] Event handling failed:', error))
            );
            roomChains.set(event.room_id, next);
            void next.then(() => {
                if (roomChains.get(event.room_id) === next) roomChains.delete(event.room_id);
            });
        }
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
    return Object.assign(router, { settle });
}
