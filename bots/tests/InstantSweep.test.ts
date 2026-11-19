/**
 * Orbit's Instant sweep is asked for by the bot server (nothing asked for it before): the call itself, the timer, and that the bot
 * server starts the timer at all.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn(), request: vi.fn(), isAxiosError: () => false }, isAxiosError: () => false }));
vi.mock('@sentry/node', () => ({ captureException: vi.fn() }));
vi.mock('../mcp/MCPConnector', () => ({ MCPConnector: { clearCache: vi.fn() } }));
vi.mock('../utils/MovementLogger', () => ({ movementLogger: {} }));

import axios from 'axios';
import { AdminApiService } from '../server/AdminApiService';
import { INSTANT_SWEEP_EVERY_MS, startInstantSweep } from '../server/InstantSweep';

const request = axios.request as unknown as ReturnType<typeof vi.fn>;

afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    delete process.env.BOT_SERVICE_TOKEN;
});

describe('the Instant sweep (asked for by the bot server)', () => {
    it('asks Orbit’s Instant sweep with the same service call as the computer sweep', async () => {
        process.env.BOT_SERVICE_TOKEN = 'secret';
        request.mockResolvedValueOnce({ status: 200, data: { looked: 0 } });
        await new AdminApiService('http://orbit.test', 'admin-token').sweepInstant();
        expect(request).toHaveBeenCalledWith(expect.objectContaining({ method: 'post', url: 'http://orbit.test/api/instant/sweep', data: {} }));
        expect(request.mock.calls[0][0].headers.Authorization).toBe('Bearer secret');
    });

    it('never throws when Orbit cannot be asked', async () => {
        process.env.BOT_SERVICE_TOKEN = 'secret';
        request.mockRejectedValueOnce(new Error('down'));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        await expect(new AdminApiService('http://orbit.test', 'admin-token').sweepInstant()).resolves.toBeUndefined();
        warn.mockRestore();
    });

    it('asks on every tick, keeps going after a failure, and never starts a second pass over a running one', async () => {
        vi.useFakeTimers();
        let release: () => void = () => undefined;
        const sweepInstant = vi
            .fn<() => Promise<void>>()
            .mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)))
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValue(undefined);
        const stop = startInstantSweep({ sweepInstant });
        expect(sweepInstant).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(INSTANT_SWEEP_EVERY_MS);
        expect(sweepInstant).toHaveBeenCalledTimes(1);
        // The first pass is slow: the next ticks do not pile up on it
        await vi.advanceTimersByTimeAsync(INSTANT_SWEEP_EVERY_MS * 2);
        expect(sweepInstant).toHaveBeenCalledTimes(1);

        release();
        await vi.advanceTimersByTimeAsync(INSTANT_SWEEP_EVERY_MS);
        expect(sweepInstant).toHaveBeenCalledTimes(2);
        // The second pass threw: the timer still goes on
        await vi.advanceTimersByTimeAsync(INSTANT_SWEEP_EVERY_MS);
        expect(sweepInstant).toHaveBeenCalledTimes(3);

        stop();
        await vi.advanceTimersByTimeAsync(INSTANT_SWEEP_EVERY_MS * 3);
        expect(sweepInstant).toHaveBeenCalledTimes(3);
    });

    it('is started by the bot server next to the computer sweep, and stopped at shutdown', () => {
        const source = readFileSync(join(__dirname, '../server/index.ts'), 'utf8');
        expect(source).toMatch(/stopInstantSweep\s*=\s*startInstantSweep\(adminApiService\)/);
        expect(source).toMatch(/stopInstantSweep\?\.\(\)/);
    });
});
