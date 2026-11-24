/**
 * The operator's way to send the dead letters again now (rows of Orbit's fault record that Orbit refused alone while it took others, kept apart): one POST,
 * protected by the bot service token, for one job (`{ "jobId": "..." }`) or for all (`{ "all": true }`). It answers counts only, never a row.
 */
import express, { type Request, type Response, type Router } from 'express';
import { timingSafeEqual } from 'crypto';

export const FAULT_REPLAY_PATH = '/internal/computer/fault-dead-letters/replay';

export interface FaultReplayDeps {
    /** The token the caller must present in `x-bot-service-token` (the operator convention of this server). */
    token: () => string | undefined;
    /** Puts the dead letters back among the rows waiting for Orbit (one job, or all when undefined); how many, or null when the store cannot be read. */
    replay: (jobId?: string) => Promise<number | null>;
}

export function createFaultReplayRoute(deps: FaultReplayDeps): Router {
    const router = express.Router();
    router.post(FAULT_REPLAY_PATH, express.json({ limit: '2kb' }), async (req: Request, res: Response) => {
        const expected = deps.token();
        const presented = req.headers['x-bot-service-token'];
        const a = Buffer.from(typeof presented === 'string' ? presented : '');
        const b = Buffer.from(expected || '');
        if (!expected || a.length !== b.length || !timingSafeEqual(a, b)) {
            res.status(403).json({ error: 'Operator access only' });
            return;
        }
        const body = (req.body ?? {}) as { jobId?: unknown; all?: unknown };
        const jobId = typeof body.jobId === 'string' && body.jobId.trim() !== '' ? body.jobId.trim() : undefined;
        if ((jobId === undefined) === (body.all !== true)) {
            res.status(400).json({ error: 'Say which: a jobId, or all: true' });
            return;
        }
        try {
            const queued = await deps.replay(jobId);
            if (queued === null) {
                res.status(503).json({ error: 'The dead letters could not be read' });
                return;
            }
            res.json({ ok: true, queued });
        } catch {
            res.status(500).json({ error: 'Could not replay' });
        }
    });
    return router;
}
