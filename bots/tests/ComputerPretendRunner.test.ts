/** The pretend runner of the development server does nothing more once it is stopped, whatever call was still on its way. */
import { describe, expect, it, vi } from 'vitest';
import { runPretendJob } from '../ai/ComputerPretendRunner';

describe('the pretend computer runner, stopped while a call is on its way', () => {
    it('renews and posts nothing after stop(), and schedules no further tick', async () => {
        vi.useFakeTimers();
        let release!: (job: unknown) => void;
        const getComputerJob = vi.fn(() => new Promise((resolve) => void (release = resolve)));
        const computerJobAction = vi.fn(async () => ({ ok: true }));
        const stop = runPretendJob({ getComputerJob, computerJobAction } as never, 'bot', 'job', 10);
        await vi.advanceTimersByTimeAsync(0);
        expect(getComputerJob).toHaveBeenCalledTimes(1);
        // Stopped while the job is being read: the read comes back "running" afterwards
        stop();
        release({ status: 'running' });
        await vi.advanceTimersByTimeAsync(100);
        expect(computerJobAction).not.toHaveBeenCalled();
        expect(getComputerJob).toHaveBeenCalledTimes(1);
        vi.useRealTimers();
    });

    it('stops after a renew that was on its way, before posting progress', async () => {
        vi.useFakeTimers();
        let release!: (value: unknown) => void;
        const getComputerJob = vi.fn(async () => ({ status: 'running' }));
        const computerJobAction = vi.fn((_bot: string, _job: string, body: { action: string }) => (body.action === 'renew' ? new Promise((resolve) => void (release = resolve)) : Promise.resolve({ ok: true })));
        const stop = runPretendJob({ getComputerJob, computerJobAction } as never, 'bot', 'job', 10);
        await vi.advanceTimersByTimeAsync(0);
        stop();
        release({ ok: true });
        await vi.advanceTimersByTimeAsync(100);
        expect(computerJobAction.mock.calls.map((call) => call[2].action)).toEqual(['renew']);
        vi.useRealTimers();
    });
});
