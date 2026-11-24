import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminApiService } from '../server/AdminApiService';

const report = { outcome: 'spoke', result: 'The site shows Issued', reached: true, progress: undefined };

function service(brickCall: (...args: unknown[]) => Promise<unknown>) {
    const orbit = new AdminApiService('http://orbit.test', 'admin-token');
    const call = vi.fn(brickCall);
    (orbit as unknown as { brickCall: typeof call }).brickCall = call;
    return { orbit, call };
}

describe('keeping where a run spoke', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('sends the event id alone for a reminder, and the report with it for a goal, without empty parts', async () => {
        const plain = service(async () => ({}));
        expect(await plain.orbit.keepItemDelivered('run 1', '$e1')).toBe(true);
        expect(plain.call).toHaveBeenCalledWith('post', 'api/bricks/items/runs/run%201/delivered', { eventId: '$e1' });
        const goal = service(async () => ({}));
        expect(await goal.orbit.keepItemDelivered('run-1', '$e1', report)).toBe(true);
        expect(goal.call).toHaveBeenCalledTimes(1);
        expect(goal.call.mock.calls[0][2]).toEqual({ eventId: '$e1', report: { outcome: 'spoke', result: 'The site shows Issued', reached: true } });
    });

    it('keeps the event id alone when an Orbit from before the report is kept refuses the call that carries one', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const old = service(async (_method, _path, body) => {
            if ((body as Record<string, unknown>).report) throw Object.assign(new Error('Invalid input data'), { response: { status: 400 } });
            return {};
        });
        expect(await old.orbit.keepItemDelivered('run-1', '$e1', report)).toBe(true);
        expect(old.call).toHaveBeenCalledTimes(2);
        expect(old.call.mock.calls[1][2]).toEqual({ eventId: '$e1' });
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('tries a call again that fails for a reason that is not a refusal, with the report still on it, and keeps it when the retry gets through', async () => {
        vi.useFakeTimers();
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        for (const failure of [Object.assign(new Error('503'), { response: { status: 503 } }), Object.assign(new Error('slow'), { response: { status: 429 } }), Object.assign(new Error('timeout'), { code: 'ECONNABORTED' })]) {
            let failed = 0;
            const flaky = service(async () => {
                if (failed++ < 2) throw failure;
                return {};
            });
            const kept = flaky.orbit.keepItemDelivered('run-1', '$e1', report);
            await vi.advanceTimersByTimeAsync(2_000);
            expect(await kept).toBe(true);
            expect(flaky.call).toHaveBeenCalledTimes(3);
            for (const [, , body] of flaky.call.mock.calls) expect((body as Record<string, unknown>).report).toBeDefined();
        }
    });

    it('says it was not kept, without dropping to the event id alone, when the call keeps failing for a reason that is not a refusal', async () => {
        vi.useFakeTimers();
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const down = service(async () => {
            throw Object.assign(new Error('503'), { response: { status: 503 } });
        });
        const kept = down.orbit.keepItemDelivered('run-1', '$e1', report);
        await vi.advanceTimersByTimeAsync(2_000);
        expect(await kept).toBe(false);
        expect(down.call).toHaveBeenCalledTimes(3);
        for (const [, , body] of down.call.mock.calls) expect((body as Record<string, unknown>).report).toBeDefined();
    });

    it('says it was not kept when Orbit refuses both', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const down = service(async () => {
            throw Object.assign(new Error('no'), { response: { status: 400 } });
        });
        expect(await down.orbit.keepItemDelivered('run-1', '$e1', report)).toBe(false);
        expect(down.call).toHaveBeenCalledTimes(2);
        expect(await down.orbit.keepItemDelivered('run-1', '$e1')).toBe(false);
    });
});

describe('a Brick call without Orbit set up', () => {
    afterEach(() => vi.unstubAllEnvs());

    it('rejects instead of throwing, so a reply that is closed with finishGuestBrickReply never throws', async () => {
        vi.stubEnv('BOT_SERVICE_TOKEN', '');
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const orbit = new AdminApiService('http://orbit.test', 'admin-token');
        await expect(orbit.finishGuestBrickReply('turn-1', { failed: true })).resolves.toBeUndefined();
    });
});
