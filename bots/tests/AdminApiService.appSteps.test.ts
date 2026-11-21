import { describe, expect, it, vi } from 'vitest';
import { AdminApiService, COMPUTER_START_TIMEOUT_MS, isSlowAnswer } from '../server/AdminApiService';

function service(answer: () => Promise<unknown>) {
    const orbit = new AdminApiService('http://orbit.test', 'admin-token');
    const call = vi.fn(answer);
    (orbit as unknown as { brickCall: typeof call }).brickCall = call;
    return { orbit, call };
}

describe('asking Orbit at 20 app steps', () => {
    it('sends the person, the App and the steps to the Brick, and reads only a plain yes as one', async () => {
        const yes = service(async () => ({ data: { review: true } }));
        expect(await yes.orbit.reviewAppSteps('brick 1', 'u1', 'Notion', 20)).toBe(true);
        expect(yes.call).toHaveBeenCalledWith('post', 'api/bots/brick%201/computer-route-review', { userId: 'u1', app: 'Notion', steps: 20 });
        expect(await service(async () => ({ data: { review: false } })).orbit.reviewAppSteps('b', 'u', 'Notion', 20)).toBe(false);
        expect(await service(async () => ({ data: { review: 'yes' } })).orbit.reviewAppSteps('b', 'u', 'Notion', 20)).toBe(false);
        expect(await service(async () => ({ data: undefined })).orbit.reviewAppSteps('b', 'u', 'Notion', 20)).toBe(false);
    });

    it('throws when Orbit cannot be reached, so the caller adds nothing', async () => {
        await expect(service(async () => { throw new Error('down'); }).orbit.reviewAppSteps('b', 'u', 'Notion', 20)).rejects.toThrow('down');
    });
});

describe('what Orbit answers to a job that did not start', () => {
    it('reads a refusal that comes back with the answer (Orbit says no in the body of a 200), and keeps the app it names', async () => {
        const refused = service(async () => ({ data: { ok: false, reason: 'cheaper_route', app: 'Notion' } }));
        expect(await refused.orbit.startComputerJob('b', 'u', { title: 'Add a page', plan: { app: 'Notion', steps: 3 } })).toEqual({ ok: false, reason: 'cheaper_route', app: 'Notion' });
        expect(refused.call).toHaveBeenCalledWith('post', 'api/bots/b/computer-jobs', { userId: 'u', title: 'Add a page', plan: { app: 'Notion', steps: 3 } }, undefined, COMPUTER_START_TIMEOUT_MS);
        expect(await service(async () => ({ data: { ok: false, reason: 'off' } })).orbit.startComputerJob('b', 'u', { title: 'x' })).toEqual({ ok: false, reason: 'off' });
    });

    it('sends whether the person is a guest with the id when it is known, and leaves it out when it is not', async () => {
        const known = service(async () => ({ data: { ok: true, job: { id: 'j', status: 'queued', queuedFor: null } } }));
        await known.orbit.startComputerJob('b', 'u', { title: 'x', isGuest: false });
        expect(known.call).toHaveBeenCalledWith('post', 'api/bots/b/computer-jobs', { userId: 'u', isGuest: false, title: 'x' }, undefined, COMPUTER_START_TIMEOUT_MS);
        const guest = service(async () => ({ data: { ok: true, job: { id: 'j', status: 'queued', queuedFor: null } } }));
        await guest.orbit.startComputerJob('b', 'u', { title: 'x', isGuest: true });
        expect((guest.call.mock.calls[0] as unknown[])[2]).toMatchObject({ isGuest: true });
        const unknown = service(async () => ({ data: { ok: true, job: { id: 'j', status: 'queued', queuedFor: null } } }));
        await unknown.orbit.startComputerJob('b', 'u', { title: 'x' });
        expect((unknown.call.mock.calls[0] as unknown[])[2]).not.toHaveProperty('isGuest');
    });

    it('throws for an answer it cannot get (Orbit down), so the caller says the computer could not be reached', async () => {
        await expect(service(async () => { throw new Error('503'); }).orbit.startComputerJob('b', 'u', { title: 'x' })).rejects.toThrow('503');
    });
});

describe('the first job on a brand-new Brick, whose machine is made inside the start call', () => {
    const MADE = { data: { ok: true, job: { id: 'j1', status: 'running', queuedFor: null }, restoredFrom: null } };
    const timedOut = () => Object.assign(new Error('timeout of 8000ms exceeded'), { code: 'ECONNABORTED' });

    it('waits longer than Orbit does for a machine (its ready wait is 4 minutes), and sends that wait with the start', async () => {
        expect(COMPUTER_START_TIMEOUT_MS).toBeGreaterThan(4 * 60_000);
        const { orbit, call } = service(async () => MADE);
        await orbit.startComputerJob('b', 'u', { title: 'x' });
        expect((call.mock.calls[0] as unknown[])[4]).toBe(COMPUTER_START_TIMEOUT_MS);
    });

    it('takes an answer that comes after 20 seconds as the answer', async () => {
        vi.useFakeTimers();
        try {
            const { orbit } = service(() => new Promise((resolve) => setTimeout(() => resolve(MADE), 20_000)));
            const started = orbit.startComputerJob('b', 'u', { title: 'x' });
            await vi.advanceTimersByTimeAsync(20_000);
            expect(await started).toEqual({ ok: true, job: { id: 'j1', status: 'running', queuedFor: null }, restoredFrom: null });
        } finally {
            vi.useRealTimers();
        }
    });

    it('answers "starting" when the start timed out and Orbit now has a job running or waiting for this person', async () => {
        const calls: string[] = [];
        const { orbit } = service(async () => ({ data: {} }));
        (orbit as unknown as { brickCall: unknown }).brickCall = vi.fn(async (method: string) => {
            calls.push(method);
            if (method === 'post') throw timedOut();
            return { data: { available: true, on: true, busy: true } };
        });
        expect(await orbit.startComputerJob('b', 'u', { title: 'x' })).toEqual({ ok: false, reason: 'starting' });
        expect(calls).toEqual(['post', 'get']);
        const asked = (orbit as unknown as { brickCall: ReturnType<typeof vi.fn> }).brickCall.mock.calls[1];
        expect(asked.slice(0, 4)).toEqual(['get', 'api/bots/b/computer-jobs', undefined, { userId: 'u' }]);
    });

    it('still throws when the start timed out and nothing is going on (or Orbit cannot say), so the computer is reported as not reached', async () => {
        for (const busy of [{ data: { busy: false } }, { data: {} }, 'down'] as const) {
            const { orbit } = service(async () => ({ data: {} }));
            (orbit as unknown as { brickCall: unknown }).brickCall = vi.fn(async (method: string) => {
                if (method === 'post') throw timedOut();
                if (busy === 'down') throw new Error('down');
                return busy;
            });
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
            await expect(orbit.startComputerJob('b', 'u', { title: 'x' })).rejects.toThrow('timeout');
            warn.mockRestore();
        }
    });

    it('asks about a job running only for a start that took too long, not for any other failure', async () => {
        const { orbit, call } = service(async () => { throw Object.assign(new Error('503'), { response: { status: 503 } }); });
        await expect(orbit.startComputerJob('b', 'u', { title: 'x' })).rejects.toThrow('503');
        expect(call).toHaveBeenCalledTimes(1);
        expect(isSlowAnswer(timedOut())).toBe(true);
        expect(isSlowAnswer(Object.assign(new Error('x'), { code: 'ETIMEDOUT' }))).toBe(true);
        expect(isSlowAnswer(Object.assign(new Error('x'), { response: { status: 504 } }))).toBe(true);
        expect(isSlowAnswer(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }))).toBe(false);
        expect(isSlowAnswer(new Error('x'))).toBe(false);
        expect(isSlowAnswer(undefined)).toBe(false);
    });

    it('reads busy exactly, and a failure is not busy', async () => {
        expect(await service(async () => ({ data: { busy: true } })).orbit.computerIsBusy('b', 'u')).toBe(true);
        expect(await service(async () => ({ data: { busy: 'yes' } })).orbit.computerIsBusy('b', 'u')).toBe(false);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        expect(await service(async () => { throw new Error('down'); }).orbit.computerIsBusy('b', 'u')).toBe(false);
        warn.mockRestore();
    });
});
