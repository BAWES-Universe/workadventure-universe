import { describe, expect, it, vi } from 'vitest';
import { AdminApiService } from '../server/AdminApiService';

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
        expect(refused.call).toHaveBeenCalledWith('post', 'api/bots/b/computer-jobs', { userId: 'u', title: 'Add a page', plan: { app: 'Notion', steps: 3 } });
        expect(await service(async () => ({ data: { ok: false, reason: 'off' } })).orbit.startComputerJob('b', 'u', { title: 'x' })).toEqual({ ok: false, reason: 'off' });
    });

    it('throws for an answer it cannot get (Orbit down), so the caller says the computer could not be reached', async () => {
        await expect(service(async () => { throw new Error('503'); }).orbit.startComputerJob('b', 'u', { title: 'x' })).rejects.toThrow('503');
    });
});
