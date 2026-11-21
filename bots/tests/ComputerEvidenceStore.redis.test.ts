import { randomUUID } from 'crypto';
import { createClient } from 'redis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CALLED_PREFIX, RedisSharedCalls } from '../server/ComputerEvidenceStore';

/**
 * The two Lua scripts of the fence of a turn against a real Redis: the unit tests run their JavaScript twins in memory, so a change to the Lua would not show
 * there. Runs when a Redis is given in BOTS_TEST_REDIS_URL (the same one the forget queue tests use), and is skipped when there is none. The CI job of the bots
 * gives one (a Redis service) and sets BOTS_REQUIRE_REDIS: there, a missing Redis fails the run instead of skipping the tests. Every job id is new for each run and
 * its hash is deleted at the end: nothing else in the database is touched.
 */
const REAL_REDIS = process.env.BOTS_TEST_REDIS_URL;
describe.runIf(process.env.BOTS_REQUIRE_REDIS === '1' && !REAL_REDIS)('the real Redis for the fence tests', () => {
    it('is given when the run requires it (CI): the fence is never left untested', () => {
        expect(REAL_REDIS, 'BOTS_TEST_REDIS_URL is not set while BOTS_REQUIRE_REDIS=1').toBeTruthy();
    });
});
describe.skipIf(!REAL_REDIS)('the fence of a turn, on a real Redis (the scripts themselves)', () => {
    let client: ReturnType<typeof createClient>;
    const run = randomUUID();
    const jobs: string[] = [];
    const job = (name: string) => {
        const id = `${name}-${run}`;
        jobs.push(id);
        return id;
    };
    beforeAll(async () => {
        client = createClient({ url: REAL_REDIS });
        await client.connect();
    });
    afterAll(async () => {
        if (jobs.length > 0) await client.del(jobs.map((id) => CALLED_PREFIX + id));
        await client.quit();
    });

    it('closes a turn only when no other server took up a call of it, and refuses a call for a turn that was closed (the same answers as the in-memory twins)', async () => {
        const a = new RedisSharedCalls(() => client as never, 'A');
        const b = new RedisSharedCalls(() => client as never, 'B');
        const c = new RedisSharedCalls(() => client as never, 'C');
        const j = job('j');
        // B takes up a call of turn 5 run r at 1000; A tries to close turn 5 from 500
        expect(await b.noteAccepted(j, 1000, { turn: 5, run: 'r' })).toBe(true);
        expect(await a.closeTurn(j, { turn: 5, run: 'r' }, 500, 2000)).toBe(false);
        // an acceptance for another turn does not count
        expect(await a.closeTurn(j, { turn: 6, run: 'r' }, 500, 2000)).toBe(true);
        // after the fence for 6 B's acceptance for 6 is refused, for 5 and 7 is not
        expect(await b.noteAccepted(j, 2100, { turn: 6, run: 'r' })).toBe(false);
        expect(await b.noteAccepted(j, 2100, { turn: 7, run: 'r' })).toBe(true);
        expect(await c.noteAccepted(j, 2100, { turn: 6, run: 'other' })).toBe(true);
        // unknown turn: refused within 10 s of a fence, accepted later
        expect(await b.noteAccepted(j, 2200)).toBe(false);
        expect(await b.noteAccepted(j, 2000 + 10_001)).toBe(true);
        // an old acceptance (before the window minus the skew) does not count
        const k = job('k');
        await b.noteAccepted(k, 100, { turn: 1 });
        expect(await a.closeTurn(k, { turn: 1 }, 5000, 6000)).toBe(true);
        // an acceptance whose turn was not known counts for every turn
        const m = job('m');
        await b.noteAccepted(m, 5);
        expect(await a.closeTurn(m, { turn: 3, run: 'x' }, 0, 10)).toBe(false);
        // the closing server's own acceptances are in its own notes, not read here
        const n = job('n');
        await a.noteAccepted(n, 1000, { turn: 1 });
        expect(await a.closeTurn(n, { turn: 1 }, 0, 2000)).toBe(true);
        // the fence is no call that arrived
        expect(await b.lastCalledByOthers(n)).toBeNull();
        // the hash keeps its life
        expect(await client.ttl(CALLED_PREFIX + j)).toBeGreaterThan(0);
    });
});
