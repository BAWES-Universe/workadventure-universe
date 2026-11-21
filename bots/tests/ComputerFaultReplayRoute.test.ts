import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createFaultReplayRoute, FAULT_REPLAY_PATH } from '../server/ComputerFaultReplayRoute';

let server: Server;
let base: string;
let token: string | undefined = 'service-token';
const replay = vi.fn<(jobId?: string) => Promise<number | null>>();

beforeAll(async () => {
    const app = express();
    app.use(createFaultReplayRoute({ token: () => token, replay }));
    server = await new Promise<Server>((resolve) => {
        const s = app.listen(0, () => resolve(s));
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
});
beforeEach(() => {
    token = 'service-token';
    replay.mockReset().mockResolvedValue(2);
});
const post = (body: unknown, headers: Record<string, string> = { 'x-bot-service-token': 'service-token' }) =>
    fetch(`${base}${FAULT_REPLAY_PATH}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

describe('the operator route that sends the dead letters again', () => {
    it('replays one job, or all, and answers counts only', async () => {
        const one = await post({ jobId: 'job-1' });
        expect(one.status).toBe(200);
        expect(await one.json()).toEqual({ ok: true, queued: 2 });
        expect(replay).toHaveBeenLastCalledWith('job-1');
        const all = await post({ all: true });
        expect(await all.json()).toEqual({ ok: true, queued: 2 });
        expect(replay).toHaveBeenLastCalledWith(undefined);
    });

    it('refuses a caller without the bot service token, or when none is set, and replays nothing', async () => {
        expect((await post({ all: true }, {})).status).toBe(403);
        expect((await post({ all: true }, { 'x-bot-service-token': 'wrong-token!' })).status).toBe(403);
        expect((await post({ all: true }, { 'x-bot-service-token': 'service-toke' })).status).toBe(403);
        token = undefined;
        expect((await post({ all: true }, { 'x-bot-service-token': '' })).status).toBe(403);
        expect(replay).not.toHaveBeenCalled();
    });

    it('wants a job or all, one of them', async () => {
        expect((await post({})).status).toBe(400);
        expect((await post({ jobId: 'j', all: true })).status).toBe(400);
        expect((await post({ jobId: '   ' })).status).toBe(400);
        expect((await post({ all: 'yes' })).status).toBe(400);
        expect(replay).not.toHaveBeenCalled();
    });

    it('says plainly when the dead letters cannot be read or the replay fails, with no row in the answer', async () => {
        replay.mockResolvedValueOnce(null);
        expect((await post({ all: true })).status).toBe(503);
        replay.mockRejectedValueOnce(new Error('secret row content'));
        const failed = await post({ all: true });
        expect(failed.status).toBe(500);
        expect(JSON.stringify(await failed.json())).not.toContain('secret');
    });
});
