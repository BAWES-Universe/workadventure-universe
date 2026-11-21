import { describe, expect, it } from 'vitest';
import { DEAD_PREFIX, DEAD_TTL_SECONDS, DELETE_IF_UNCHANGED, EVIDENCE_PREFIX, EVIDENCE_TTL_SECONDS, RedisEvidenceStore, type EvidenceRedis } from '../server/ComputerEvidenceStore';
import { createRefusalNotes, EVIDENCE_KEEP_MS, type CallRow } from '../server/ComputerRefusals';

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
const NOW = Date.parse('2026-11-20T10:05:00.000Z');

/** The few commands the store uses, in memory (hashes, their life, and a scan that gives a few keys at a time). */
function fakeRedis() {
    const hashes = new Map<string, Map<string, string>>();
    const ttl = new Map<string, number>();
    const hash = (key: string) => hashes.get(key) ?? hashes.set(key, new Map()).get(key)!;
    const state = { down: false, silent: false, pageSize: 2, scans: 0, wrongTypes: new Set<string>(), beforeEval: undefined as undefined | (() => void) };
    const gate = async <T>(work: () => T): Promise<T> => {
        if (state.down) throw new Error('Redis went away');
        if (state.silent) return new Promise<T>(() => undefined);
        return work();
    };
    const client: EvidenceRedis = {
        hGetAll: (key) =>
            gate(() => {
                if (state.wrongTypes.has(key)) throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
                return Object.fromEntries(hashes.get(key) ?? []);
            }),
        hSet: (key, field, value) => gate(() => (hash(key).set(field, value), 1)),
        hDel: (key, fields) =>
            gate(() => {
                for (const field of Array.isArray(fields) ? fields : [fields]) hashes.get(key)?.delete(field);
                if (hashes.get(key)?.size === 0) hashes.delete(key);
                return 1;
            }),
        // The one script the store runs: delete each field only while it holds the value it was given, as one step
        eval: (script, options) =>
            gate(() => {
                if (script !== DELETE_IF_UNCHANGED) throw new Error('an unknown script');
                state.beforeEval?.();
                let removed = 0;
                for (let i = 0; i < options.arguments.length; i += 2) {
                    if (hashes.get(options.keys[0])?.get(options.arguments[i]) === options.arguments[i + 1]) {
                        hashes.get(options.keys[0])?.delete(options.arguments[i]);
                        removed++;
                    }
                }
                if (hashes.get(options.keys[0])?.size === 0) hashes.delete(options.keys[0]);
                return removed;
            }),
        expire: (key, seconds) => gate(() => (ttl.set(key, seconds), 1)),
        scan: (cursor, options) =>
            gate(() => {
                state.scans++;
                const prefix = options.MATCH.replace(/\*$/, '');
                const keys = [...hashes.keys()].filter((key) => key.startsWith(prefix));
                const page = keys.slice(cursor, cursor + state.pageSize);
                const next = cursor + state.pageSize;
                return { cursor: next >= keys.length ? 0 : next, keys: page };
            }),
    };
    return {
        client,
        state,
        ttl,
        keys: () => [...hashes.keys()].sort(),
        fields: (jobId: string) => [...(hashes.get(EVIDENCE_PREFIX + jobId)?.keys() ?? [])].sort(),
        raw: (jobId: string, field: string, value: string) => hash(EVIDENCE_PREFIX + jobId).set(field, value),
    };
}

describe('the evidence kept for Orbit in the shared store', () => {
    it('keeps a row in the hash of its job under its call id with a life of 7 days, brings it back unchanged with its bot, and removes it when Orbit has taken it', async () => {
        const redis = fakeRedis();
        const store = new RedisEvidenceStore(() => redis.client, () => NOW);
        expect(await store.save('bot-1', 'job-1', row('c1'))).toBe(true);
        expect(await store.save('bot-1', 'job-1', row('c2', { kind: 'uncertain', reason: 'stream_cut', providerStatus: null }))).toBe(true);
        expect(await store.save('bot-2', 'job-2', row('c3'))).toBe(true);
        // the same row again replaces itself
        expect(await store.save('bot-1', 'job-1', row('c1', { kind: 'uncertain', reason: 'provider_5xx', providerStatus: 500 }))).toBe(true);
        expect(redis.keys()).toEqual(['computer:faults:pending:job-1', 'computer:faults:pending:job-2']);
        expect(redis.fields('job-1')).toEqual(['c1', 'c2']);
        expect(EVIDENCE_TTL_SECONDS).toBe(7 * 24 * 60 * 60);
        expect(redis.ttl.get('computer:faults:pending:job-1')).toBe(EVIDENCE_TTL_SECONDS);
        const loaded = await store.load();
        expect(loaded.map((job) => [job.botId, job.jobId, job.rows.map((one) => one.callId).sort()]).sort()).toEqual([
            ['bot-1', 'job-1', ['c1', 'c2']],
            ['bot-2', 'job-2', ['c3']],
        ]);
        expect(loaded.find((job) => job.jobId === 'job-1')?.rows.find((one) => one.callId === 'c1')).toEqual(row('c1', { kind: 'uncertain', reason: 'provider_5xx', providerStatus: 500 }));
        await store.drop('bot-1', 'job-1', [row('c2', { kind: 'uncertain', reason: 'stream_cut', providerStatus: null }), row('c1', { kind: 'uncertain', reason: 'provider_5xx', providerStatus: 500 })]);
        expect(redis.keys()).toEqual(['computer:faults:pending:job-2']);
        await store.drop('bot-1', 'job-1', []);
    });

    it('finds every job’s hash whatever the page size of the scan', async () => {
        const redis = fakeRedis();
        const store = new RedisEvidenceStore(() => redis.client, () => NOW);
        for (let n = 0; n < 7; n++) await store.save('b', `job-${n}`, row(`c${n}`));
        const loaded = await store.load();
        expect(loaded.map((job) => job.jobId).sort()).toEqual(['job-0', 'job-1', 'job-2', 'job-3', 'job-4', 'job-5', 'job-6']);
        expect(redis.state.scans).toBeGreaterThan(1);
    });

    it('holds ids, a reason and times only: nothing anyone said and no key', async () => {
        const redis = fakeRedis();
        const store = new RedisEvidenceStore(() => redis.client, () => NOW);
        await store.save('bot-1', 'job-1', row('c1'));
        const all = await redis.client.hGetAll('computer:faults:pending:job-1');
        const stored = JSON.parse(all.c1) as Record<string, unknown>;
        expect(Object.keys(stored).sort()).toEqual(['botId', 'row']);
        expect(Object.keys(stored.row as object).sort()).toEqual(['at', 'callId', 'kind', 'providerStatus', 'reason', 'route', 'run', 'source', 'turn']);
    });

    it('says false for a row it could not keep, and a store that is not connected or silent never holds the caller', async () => {
        const redis = fakeRedis();
        const store = new RedisEvidenceStore(() => redis.client, Date.now, 50);
        redis.state.down = true;
        expect(await store.save('b', 'j', row('c1'))).toBe(false);
        await expect(store.drop('b', 'j', [row('c1')])).resolves.toBeUndefined();
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

    it('skips a damaged or foreign entry without stopping the others, and removes a row older than the time rows are kept', async () => {
        const redis = fakeRedis();
        let at = NOW;
        const store = new RedisEvidenceStore(() => redis.client, () => at);
        await store.save('b', 'j', row('good'));
        redis.raw('j', 'damaged', '{not json');
        redis.raw('j', 'nokind', JSON.stringify({ botId: 'b', row: { ...row('nokind'), kind: 'answered' } }));
        redis.raw('j', 'mismatch', JSON.stringify({ botId: 'b', row: row('other') }));
        redis.raw('j', 'badturn', JSON.stringify({ botId: 'b', row: { ...row('badturn'), turn: -1 } }));
        redis.raw('j', 'nobot', JSON.stringify({ row: row('nobot') }));
        redis.raw('', 'x', '{}');
        const loaded = await store.load();
        expect(loaded).toHaveLength(1);
        expect(loaded[0].rows.map((one) => one.callId)).toEqual(['good']);
        // later than the time rows are kept, the row is too old to bring back, and is taken out
        at = Date.parse(row('good').at) + EVIDENCE_KEEP_MS + 1;
        expect(await store.load()).toEqual([]);
        expect(redis.fields('j')).not.toContain('good');
    });

    it('kill the process with rows pending, start another on the same Redis: the rows are replayed under the same call, run and turn, and only then removed', async () => {
        const redis = fakeRedis();
        redis.state.pageSize = 100;
        // the first bot server: Orbit is not answering when its calls end
        const first = createRefusalNotes(() => NOW, { retryMs: [], laterMs: [], sink: async () => false, store: new RedisEvidenceStore(() => redis.client, () => NOW) });
        first.turn('job-1', 3, 'run-q');
        first.record('bot-1', 'job-1', { callId: 'c1', kind: 'uncertain', reason: 'provider_5xx', source: 'own-key', route: 'own-key', providerStatus: 500 });
        first.record('bot-1', 'job-1', { callId: 'c2', kind: 'fault', reason: 'relay_down', source: 'universe-ai', route: 'universe-ai:p1', providerStatus: 503 });
        await first.flush('job-1');
        expect(redis.fields('job-1')).toEqual(['c1', 'c2']);
        // it is killed: nothing of it is left but the Redis rows. The next one starts with Orbit up.
        const delivered: Array<{ botId: string; jobId: string; rows: CallRow[] }> = [];
        const second = createRefusalNotes(() => NOW + 60_000, {
            retryMs: [],
            laterMs: [],
            sink: async (botId, jobId, rows) => (delivered.push({ botId, jobId, rows: rows.map((one) => ({ ...one })) }), true),
            store: new RedisEvidenceStore(() => redis.client, () => NOW + 60_000),
        });
        expect(await second.resume()).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(delivered).toHaveLength(1);
        expect(delivered[0].botId).toBe('bot-1');
        expect(delivered[0].rows.map((one) => [one.callId, one.turn, one.run, one.kind, one.source]).sort()).toEqual([
            ['c1', 3, 'run-q', 'uncertain', 'own-key'],
            ['c2', 3, 'run-q', 'fault', 'universe-ai'],
        ]);
        expect(delivered[0].rows.every((one) => one.at === new Date(NOW).toISOString())).toBe(true);
        expect(redis.fields('job-1')).toEqual([]);
        // a replay with nothing pending sends nothing
        expect(await second.resume()).toBe(true);
        expect(delivered).toHaveLength(1);
    });
});

describe('the dead letters: rows Orbit refused alone while it took others', () => {
    it('keeps a row apart from the pending ones for 30 days under its call id, and brings it back unchanged with its bot', async () => {
        const redis = fakeRedis();
        const store = new RedisEvidenceStore(() => redis.client, () => NOW);
        expect(DEAD_TTL_SECONDS).toBe(30 * 24 * 60 * 60);
        expect(await store.deadLetter('bot-1', 'job-1', row('c1'))).toBe(true);
        expect(await store.deadLetter('bot-1', 'job-1', row('c2', { kind: 'uncertain', providerStatus: null }))).toBe(true);
        expect(await store.deadLetter('bot-2', 'job-2', row('c3'))).toBe(true);
        expect(redis.keys()).toEqual([`${DEAD_PREFIX}job-1`, `${DEAD_PREFIX}job-2`]);
        expect(redis.ttl.get(`${DEAD_PREFIX}job-1`)).toBe(DEAD_TTL_SECONDS);
        // not among the rows that wait for Orbit: a restart does not send them again by itself
        expect(await store.load()).toEqual([]);
        const dead = await store.loadDead();
        expect(dead.map((job) => [job.botId, job.jobId, job.rows.map((one) => one.callId).sort()]).sort()).toEqual([
            ['bot-1', 'job-1', ['c1', 'c2']],
            ['bot-2', 'job-2', ['c3']],
        ]);
        expect(dead.find((job) => job.jobId === 'job-1')?.rows.find((one) => one.callId === 'c1')).toEqual(row('c1'));
    });

    it('never deletes one: dropping the pending row of the same call leaves it, and a damaged entry is skipped', async () => {
        const redis = fakeRedis();
        const store = new RedisEvidenceStore(() => redis.client, () => NOW);
        await store.save('bot-1', 'job-1', row('c1'));
        await store.deadLetter('bot-1', 'job-1', row('c1'));
        await store.drop('bot-1', 'job-1', [row('c1')]);
        expect(redis.keys()).toEqual([`${DEAD_PREFIX}job-1`]);
        await redis.client.hSet(`${DEAD_PREFIX}job-1`, 'junk', 'not json');
        expect((await store.loadDead()).map((job) => job.rows.map((one) => one.callId))).toEqual([['c1']]);
    });

    it('takes a dead letter out once Orbit took it, only while it is still exactly that row', async () => {
        const redis = fakeRedis();
        const store = new RedisEvidenceStore(() => redis.client, () => NOW);
        await store.deadLetter('bot-1', 'job-1', row('c1'));
        await store.deadLetter('bot-1', 'job-1', row('c2'));
        // a newer row of the same call was set aside since: it stays
        await store.dropDead('bot-1', 'job-1', [row('c1', { providerStatus: 500 }), row('c2')]);
        expect((await store.loadDead())[0].rows.map((one) => one.callId)).toEqual(['c1']);
        await store.dropDead('bot-1', 'job-1', [row('c1')]);
        expect(await store.loadDead()).toEqual([]);
        await store.dropDead('bot-1', 'job-1', []);
        redis.state.down = true;
        await expect(store.dropDead('bot-1', 'job-1', [row('c1')])).resolves.toBeUndefined();
    });

    it('says false for a row it could not keep, and rejects a read it could not make', async () => {
        const redis = fakeRedis();
        const store = new RedisEvidenceStore(() => redis.client, () => NOW, 50);
        redis.state.down = true;
        expect(await store.deadLetter('b', 'j', row('c1'))).toBe(false);
        await expect(store.loadDead()).rejects.toThrow();
        expect(await new RedisEvidenceStore(() => null).deadLetter('b', 'j', row('c1'))).toBe(false);
    });
});

describe('what the store does not take for granted', () => {
    it('keeps a newer row of the same call id when Orbit took the older one: a drop removes only the row that was taken', async () => {
        const redis = fakeRedis();
        const store = new RedisEvidenceStore(() => redis.client, () => NOW);
        const older = row('c1', { kind: 'uncertain', reason: 'provider_5xx', providerStatus: 500 });
        const newer = row('c1', { kind: 'fault', reason: 'provider_key_ours', providerStatus: 401, at: '2026-11-20T10:01:00.000Z' });
        await store.save('bot-1', 'job-1', older);
        // the newer row is saved before the drop for the older one runs
        await store.save('bot-1', 'job-1', newer);
        await store.drop('bot-1', 'job-1', [older]);
        const kept = await store.load();
        expect(kept).toHaveLength(1);
        expect(kept[0].rows).toEqual([newer]);
        // and the row that was taken, left alone since, is removed
        await store.drop('bot-1', 'job-1', [newer]);
        expect(await store.load()).toEqual([]);
        // a row of another bot's id is not the one that was kept
        await store.save('bot-1', 'job-2', older);
        await store.drop('bot-2', 'job-2', [older]);
        expect(redis.fields('job-2')).toEqual(['c1']);
    });

    it('removes an expired row only if it is still the one that was read: one written meanwhile by another bot server stays', async () => {
        const redis = fakeRedis();
        let at = NOW;
        const store = new RedisEvidenceStore(() => redis.client, () => at);
        await store.save('b', 'j', row('old'));
        await store.save('b', 'j', row('fresh'));
        at = Date.parse(row('old').at) + EVIDENCE_KEEP_MS + 1;
        const replacement = row('old', { at: new Date(at).toISOString() });
        // after the hash was read and before the expired row is deleted, another server writes a newer row under the same call id
        redis.state.beforeEval = () => {
            redis.state.beforeEval = undefined;
            redis.raw('j', 'old', JSON.stringify({ botId: 'b', row: replacement }));
        };
        const loaded = await store.load();
        // the expired ones were not brought back, and the replacement written meanwhile was not removed
        expect(loaded.map((job) => job.rows.map((one) => one.callId))).toEqual([]);
        expect(redis.fields('j')).toContain('old');
        const again = await store.load();
        expect(again.flatMap((job) => job.rows.map((one) => one.callId))).toEqual(['old']);
    });

    it('goes on with the other jobs when a key that matches the prefix is not a hash, and still fails when the store cannot be reached', async () => {
        const redis = fakeRedis();
        redis.state.pageSize = 100;
        const store = new RedisEvidenceStore(() => redis.client, () => NOW);
        await store.save('b', 'job-1', row('c1'));
        await store.save('b', 'job-2', row('c2'));
        redis.state.wrongTypes.add('computer:faults:pending:job-1');
        const loaded = await store.load();
        expect(loaded.map((job) => job.jobId)).toEqual(['job-2']);
        redis.state.down = true;
        await expect(store.load()).rejects.toThrow();
    });
});
