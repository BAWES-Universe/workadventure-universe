import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/node', () => ({ captureMessage: vi.fn() }));

const ENV = {
    MATRIX_HOMESERVER_URL: 'http://synapse:8008',
    MATRIX_DOMAIN: 'matrix.example',
    MATRIX_AS_TOKEN: 'as',
    MATRIX_HS_TOKEN: 'hs',
} as NodeJS.ProcessEnv;
const CONFIG = { homeserverUrl: 'http://synapse:8008', domain: 'matrix.example', asToken: 'as', hsToken: 'hs' };

async function load() {
    vi.resetModules();
    const verify = await import('../matrix/verifyMatrixRegistration');
    const config = await import('../matrix/MatrixConfig');
    const sentry = await import('@sentry/node');
    return { ...verify, ...config, captureMessage: vi.mocked(sentry.captureMessage) };
}

describe('checking the Matrix registration at startup', () => {
    let error: ReturnType<typeof vi.spyOn>;
    let log: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('turns direct messages on when Synapse answers as our own application service', async () => {
        const m = await load();
        const whoami = vi.fn(async () => ({ ok: true as const, userId: '@universe-bots:matrix.example' }));
        expect(await m.verifyMatrixRegistration({ whoami }, CONFIG)).toBe(true);
        expect(log).toHaveBeenCalledWith('[BotServer] Matrix registration verified');
        expect(m.activeMatrixConfig(ENV)).toEqual(CONFIG);
        expect(m.captureMessage).not.toHaveBeenCalled();
    });

    it('turns them off, loudly and once, when Synapse does not know the token', async () => {
        const m = await load();
        const whoami = vi.fn(async () => ({ ok: false as const, status: 401, errcode: 'M_UNKNOWN_TOKEN' }));
        expect(await m.verifyMatrixRegistration({ whoami }, CONFIG)).toBe(false);
        expect(whoami).toHaveBeenCalledTimes(1);
        expect(error.mock.calls[0][0]).toContain(m.MATRIX_REJECTED_MESSAGE);
        expect(m.captureMessage).toHaveBeenCalledTimes(1);
        // No Message button anywhere: bots get no chat ID
        expect(m.activeMatrixConfig(ENV)).toBeNull();
        expect(m.readMatrixConfig(ENV)).toEqual(CONFIG);
    });

    it('turns them off when Synapse answers for another domain', async () => {
        const m = await load();
        const whoami = vi.fn(async () => ({ ok: true as const, userId: '@universe-bots:other.example' }));
        expect(await m.verifyMatrixRegistration({ whoami }, CONFIG)).toBe(false);
        expect(m.activeMatrixConfig(ENV)).toBeNull();
    });

    it('waits for a Synapse that is still starting', async () => {
        vi.useFakeTimers();
        const m = await load();
        const whoami = vi
            .fn()
            .mockRejectedValueOnce(new Error('ECONNREFUSED'))
            .mockResolvedValueOnce({ ok: false, status: 502 })
            .mockResolvedValueOnce({ ok: true, userId: '@universe-bots:matrix.example' });
        const verified = m.verifyMatrixRegistration({ whoami }, CONFIG);
        await vi.advanceTimersByTimeAsync(2_000 + 4_000);
        expect(await verified).toBe(true);
        expect(whoami).toHaveBeenCalledTimes(3);
        expect(m.activeMatrixConfig(ENV)).toEqual(CONFIG);
    });

    it('gives up after about a minute, and leaves direct messages off', async () => {
        vi.useFakeTimers();
        const m = await load();
        const whoami = vi.fn(async () => {
            throw new Error('ECONNREFUSED');
        });
        const verified = m.verifyMatrixRegistration({ whoami }, CONFIG);
        await vi.advanceTimersByTimeAsync(59_000);
        expect(await verified).toBe(false);
        expect(whoami).toHaveBeenCalledTimes(7);
        expect(error.mock.calls[0][0]).toContain(m.MATRIX_UNREACHABLE_MESSAGE);
        expect(m.captureMessage).toHaveBeenCalledTimes(1);
        expect(m.activeMatrixConfig(ENV)).toBeNull();
    });

    it('holds startup no longer than a minute when Synapse hangs instead of refusing', async () => {
        vi.useFakeTimers();
        const m = await load();
        // Stands in for the HTTP client: no answer, until the time limit it was given runs out
        const whoami = vi.fn(
            (timeoutMs: number) => new Promise<never>((_resolve, rejectLater) => setTimeout(() => rejectLater(new Error('timeout')), timeoutMs))
        );
        let done = false;
        const verified = m.verifyMatrixRegistration({ whoami }, CONFIG).finally(() => {
            done = true;
        });
        await vi.advanceTimersByTimeAsync(60_000);
        expect(done).toBe(true);
        expect(await verified).toBe(false);
        expect(Math.max(...whoami.mock.calls.map(([timeoutMs]) => timeoutMs))).toBeLessThanOrEqual(5_000);
        expect(m.activeMatrixConfig(ENV)).toBeNull();
    });

    it('does nothing when direct messages are not set up', async () => {
        const m = await load();
        expect(m.readMatrixConfig({} as NodeJS.ProcessEnv)).toBeNull();
        expect(m.activeMatrixConfig({} as NodeJS.ProcessEnv)).toBeNull();
        expect(error).not.toHaveBeenCalled();
        expect(log).not.toHaveBeenCalled();
    });
});

describe('asking Synapse who we are', () => {
    it('reads the user id on 200 and the error code otherwise', async () => {
        const { MatrixAppServiceClient } = await import('../matrix/MatrixAppServiceClient');
        const client = new MatrixAppServiceClient(CONFIG);
        const get = vi.fn();
        (client as any).http = { get };
        get.mockResolvedValueOnce({ status: 200, data: { user_id: '@universe-bots:matrix.example' } });
        expect(await client.whoami()).toEqual({ ok: true, userId: '@universe-bots:matrix.example' });
        expect(get).toHaveBeenCalledWith('/_matrix/client/v3/account/whoami', expect.objectContaining({ validateStatus: expect.any(Function) }));
        get.mockResolvedValueOnce({ status: 200, data: { user_id: '@universe-bots:matrix.example' } });
        await client.whoami(5_000);
        expect(get).toHaveBeenLastCalledWith('/_matrix/client/v3/account/whoami', expect.objectContaining({ timeout: 5_000 }));
        get.mockResolvedValueOnce({ status: 401, data: { errcode: 'M_UNKNOWN_TOKEN' } });
        expect(await client.whoami()).toEqual({ ok: false, status: 401, errcode: 'M_UNKNOWN_TOKEN' });
    });
});
