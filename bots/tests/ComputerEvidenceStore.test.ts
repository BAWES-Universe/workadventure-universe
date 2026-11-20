import { describe, expect, it } from 'vitest';
import { EVIDENCE_KEY, RedisEvidenceStore, type EvidenceRedis } from '../server/ComputerEvidenceStore';
import { EVIDENCE_KEEP_MS, type CallRow } from '../server/ComputerRefusals';

const row = (callId: string, over: Partial<CallRow> = {}): CallRow => ({
    turn: 2,
    run: 'run-a',
    callId,
    kind: 'fault',
    reason: 'provider_key_ours',
    source: 'universe-ai',
    route: 'universe-ai:p1',
    providerStatus: 401,
    at: '2026-11-20T10:00:00.000Z',
    ...over,
});

/** The few hash commands the store uses, in memory. */
function fakeRedis() {
    const hashes = new Map<string, Map<string, string>>();
    const hash = (key: string) => hashes.get(key) ?? hashes.set(key, new Map()).get(key)!;
    const state = { down: false, silent: false, calls: [] as string[] };
    const client: EvidenceRedis = {
        hGetAll: async (key) => {
            state.calls.push('hGetAll');
            if (state.silent) return new Promise(() => undefined);
            return Object.fromEntries(hash(key));
        },
        hSet: async (key, field, value) => {
            state.calls.push('hSet');
            if (state.down) throw new Error('Redis went away');
            if (state.silent) return new Promise(() => undefined);
            hash(key).set(field, value);
            return 1;
        },
        hDel: async (key, fields) => {
            state.calls.push('hDel');
            if (state.down) throw new Error('Redis went away');
            for (const field of Array.isArray(fields) ? fields : [fields]) hash(key).delete(field);
            return 1;
        },
    };
    return { client, state, fields: () => [...hash(EVIDENCE_KEY).keys()], raw: (field: string, value: string) => hash(EVIDENCE_KEY).set(field, value) };
}

describe('the evidence kept for Orbit in the shared store', () => {
    it('keeps a row under its job and call, brings it back unchanged with its bot, and removes it when Orbit has taken it', async () => {
        const redis = fakeRedis();
        const store = new RedisEvidenceStore(() => redis.client);
        expect(await store.save('bot-1', 'job-1', row('c1'))).toBe(true);
        expect(await store.save('bot-1', 'job-1', row('c2', { kind: 'uncertain', reason: 'stream_cut', providerStatus: null }))).toBe(true);
        expect(await store.save('bot-2', 'job-2', row('c3'))).toBe(true);
        // the same row again replaces itself
        expect(await store.save('bot-1', 'job-1', row('c1', { kind: 'uncertain', reason: 'provider_5xx', providerStatus: 500 }))).toBe(true);
        expect(redis.fields().sort()).toEqual(['job-1|c1', 'job-1|c2', 'job-2|c3']);
        const loaded = await store.load();
        expect(loaded.map((job) => [job.botId, job.jobId, job.rows.map((one) => one.callId).sort()]).sort()).toEqual([
            ['bot-1', 'job-1', ['c1', 'c2']],
            ['bot-2', 'job-2', ['c3']],
        ]);
        expect(loaded.find((job) => job.jobId === 'job-1')?.rows.find((one) => one.callId === 'c1')).toEqual(row('c1', { kind: 'uncertain', reason: 'provider_5xx', providerStatus: 500 }));
        await store.drop('job-1', ['c1', 'c2']);
        expect(redis.fields()).toEqual(['job-2|c3']);
        await store.drop('job-1', []);
    });

    it('holds ids, a reason and times only: nothing anyone said and no key', async () => {
        const redis = fakeRedis();
        const store = new RedisEvidenceStore(() => redis.client);
        await store.save('bot-1', 'job-1', row('c1'));
        const all = (await redis.client.hGetAll(EVIDENCE_KEY)) as Record<string, string>;
        const stored = JSON.parse(Object.values(all)[0]) as Record<string, unknown>;
        expect(Object.keys(stored).sort()).toEqual(['at', 'botId', 'jobId', 'row']);
        expect(Object.keys(stored.row as object).sort()).toEqual(['at', 'callId', 'kind', 'providerStatus', 'reason', 'route', 'run', 'source', 'turn']);
    });

    it('says false for a row it could not keep, and a store that is not connected or silent never holds the caller', async () => {
        const redis = fakeRedis();
        const store = new RedisEvidenceStore(() => redis.client, Date.now, 50);
        redis.state.down = true;
        expect(await store.save('b', 'j', row('c1'))).toBe(false);
        await expect(store.drop('j', ['c1'])).resolves.toBeUndefined();
        redis.state.down = false;
        redis.state.silent = true;
        const started = Date.now();
        expect(await store.save('b', 'j', row('c1'))).toBe(false);
        await expect(store.load()).rejects.toThrow();
        expect(Date.now() - started).toBeLessThan(1000);
        const none = new RedisEvidenceStore(() => null);
        expect(await none.save('b', 'j', row('c1'))).toBe(false);
        await expect(none.load()).rejects.toThrow();
    });

    it('skips a damaged or foreign entry without stopping the others, and removes a row older than a day', async () => {
        const redis = fakeRedis();
        let at = 1_000_000_000_000;
        const store = new RedisEvidenceStore(() => redis.client, () => at);
        await store.save('b', 'j', row('good'));
        redis.raw('j|damaged', '{not json');
        redis.raw('j|nokind', JSON.stringify({ botId: 'b', jobId: 'j', row: { ...row('nokind'), kind: 'answered' }, at }));
        redis.raw('j|mismatch', JSON.stringify({ botId: 'b', jobId: 'j', row: row('other'), at }));
        redis.raw('j|badturn', JSON.stringify({ botId: 'b', jobId: 'j', row: { ...row('badturn'), turn: -1 }, at }));
        redis.raw('j|nobot', JSON.stringify({ jobId: 'j', row: row('nobot'), at }));
        const loaded = await store.load();
        expect(loaded).toHaveLength(1);
        expect(loaded[0].rows.map((one) => one.callId)).toEqual(['good']);
        // a day and a little later the kept row is too old to bring back, and is taken out
        at += EVIDENCE_KEEP_MS + 1;
        expect(await store.load()).toEqual([]);
        expect(redis.fields()).not.toContain('j|good');
    });
});
