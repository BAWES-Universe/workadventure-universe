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
    afterEach(() => vi.restoreAllMocks());

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
            if ((body as Record<string, unknown>).report) throw new Error('Invalid input data');
            return {};
        });
        expect(await old.orbit.keepItemDelivered('run-1', '$e1', report)).toBe(true);
        expect(old.call).toHaveBeenCalledTimes(2);
        expect(old.call.mock.calls[1][2]).toEqual({ eventId: '$e1' });
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('says it was not kept when Orbit refuses both', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const down = service(async () => {
            throw new Error('down');
        });
        expect(await down.orbit.keepItemDelivered('run-1', '$e1', report)).toBe(false);
        expect(await down.orbit.keepItemDelivered('run-1', '$e1')).toBe(false);
    });
});
