import { randomUUID } from 'crypto';
import { createClient } from 'redis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CALLED_PREFIX, FENCE_LIFE_MS, RedisSharedCalls } from '../server/ComputerEvidenceStore';

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
    let client!: ReturnType<typeof createClient>;
    let opened = false;
    const run = randomUUID();
    const jobs: string[] = [];
    const job = (name: string) => {
        const id = `${name}-${run}`;
        jobs.push(id);
        return id;
    };
    beforeAll(async () => {
        // A Redis that is not there fails the setup at once and cleanly: the 'error' listener is on before the connection is tried (an error event with no listener is
        // thrown), and the client does not try to connect again for ever
        client = createClient({ url: REAL_REDIS, socket: { reconnectStrategy: false } });
        client.on('error', () => undefined);
        await client.connect();
        opened = true;
    });
    afterAll(async () => {
        // Setup that never opened the client has nothing to delete, and nothing to quit (quit on a client that never connected waits for ever)
        if (!opened || !client.isOpen) return;
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
        // unknown turn: refused within FENCE_LIFE_MS of a fence, accepted later; a known turn too: a fence that nobody took back clears itself
        expect(await b.noteAccepted(j, 2200)).toBe(false);
        expect(await b.noteAccepted(j, 2000 + FENCE_LIFE_MS, { turn: 6, run: 'r' })).toBe(false);
        expect(await b.noteAccepted(j, 2000 + FENCE_LIFE_MS)).toBe(false);
        expect(await b.noteAccepted(j, 2000 + FENCE_LIFE_MS + 1, { turn: 6, run: 'r' })).toBe(true);
        expect(await b.noteAccepted(j, 2000 + FENCE_LIFE_MS + 1)).toBe(true);
        // a fence whose moment cannot be read counts (it is never read as an old one)
        const g = job('garbage');
        await client.hSet(CALLED_PREFIX + g, 'fence:3|r', 'not-a-number');
        expect(await b.noteAccepted(g, 10 ** 9, { turn: 3, run: 'r' })).toBe(false);
        // a close made when the runner's turn was not known (`fence:|`) refuses a call of a KNOWN turn too, for FENCE_LIFE_MS; a fence of ANOTHER known turn does not
        const u = job('unscoped');
        expect(await a.closeTurn(u, undefined, 0, 4000)).toBe(true);
        expect(await b.noteAccepted(u, 4100, { turn: 2, run: 'r' })).toBe(false);
        expect(await b.noteAccepted(u, 4100, { turn: 2 })).toBe(false);
        expect(await b.noteAccepted(u, 4100)).toBe(false);
        expect(await b.noteAccepted(u, 4000 + FENCE_LIFE_MS, { turn: 2, run: 'r' })).toBe(false);
        expect(await b.noteAccepted(u, 4000 + FENCE_LIFE_MS + 1, { turn: 2, run: 'r' })).toBe(true);
        const other = job('other-turn');
        expect(await a.closeTurn(other, { turn: 1, run: 'r' }, 0, 4000)).toBe(true);
        expect(await b.noteAccepted(other, 4100, { turn: 2, run: 'r' })).toBe(true);
        expect(await b.noteAccepted(other, 4100, { turn: 1, run: 'x' })).toBe(true);
        expect(await b.noteAccepted(other, 4100, { turn: 1, run: 'r' })).toBe(false);
        // a fence whose moment cannot be read counts for a call whose turn is not known too, as it does for a known one
        const g2 = job('garbage-unknown');
        await client.hSet(CALLED_PREFIX + g2, 'fence:3|r', 'not-a-number');
        expect(await b.noteAccepted(g2, 10 ** 9)).toBe(false);
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
    it('takes a fence back only while the field holds the moment it wrote: the turn then takes calls again, and the fence of a later close or another turn stays', async () => {
        const a = new RedisSharedCalls(() => client as never, 'A');
        const b = new RedisSharedCalls(() => client as never, 'B');
        const j = job('retract');
        // a first close, then a LATER close of the same turn that writes its own moment over it, then the first close's retraction arrives late: the second fence stays
        expect(await a.closeTurn(j, { turn: 4, run: 'r' }, 0, 6999)).toBe(true);
        expect(await a.closeTurn(j, { turn: 4, run: 'r' }, 0, 7000)).toBe(true);
        await a.retractFence(j, { turn: 4, run: 'r' }, 6999);
        expect(await client.hGet(CALLED_PREFIX + j, 'fence:4|r')).toBe('7000');
        expect(await b.noteAccepted(j, 7100, { turn: 4, run: 'r' })).toBe(false);
        // another run, another turn: nothing goes
        await a.retractFence(j, { turn: 4, run: 'other' }, 7000);
        await a.retractFence(j, { turn: 5, run: 'r' }, 7000);
        expect(await b.noteAccepted(j, 7100, { turn: 4, run: 'r' })).toBe(false);
        // the moment it wrote goes, and saying it twice is no harm
        await a.retractFence(j, { turn: 4, run: 'r' }, 7000);
        await a.retractFence(j, { turn: 4, run: 'r' }, 7000);
        expect(await client.hExists(CALLED_PREFIX + j, 'fence:4|r')).toBe(false);
        expect(await b.noteAccepted(j, 7200, { turn: 4, run: 'r' })).toBe(true);
        // a close with no turn known: its field goes the same way
        const k = job('retract-unknown');
        expect(await a.closeTurn(k, undefined, 0, 9000)).toBe(true);
        expect(await b.noteAccepted(k, 9100)).toBe(false);
        await a.retractFence(k, undefined, 9000);
        expect(await b.noteAccepted(k, 9100)).toBe(true);
        // a close that ran twice with the same moment (a try whose answer was lost, then its second) is the one fence, and one retraction takes it back
        const l = job('retract-twice');
        expect(await a.closeTurn(l, { turn: 2 }, 0, 500)).toBe(true);
        expect(await a.closeTurn(l, { turn: 2 }, 0, 500)).toBe(true);
        await a.retractFence(l, { turn: 2 }, 500);
        expect(await b.noteAccepted(l, 600, { turn: 2 })).toBe(true);
    });
    describe('the committed fence of a give-up (GPT round 3, finding 4)', () => {
        const T = { turn: 6, run: 'r' };
        const servers = () => ({ a: new RedisSharedCalls(() => client as never, 'A'), b: new RedisSharedCalls(() => client as never, 'B') });
        const LATE = FENCE_LIFE_MS * 20;

        it('refuses every call of the turn and run once the give-up is committed, however long after the close it comes; a close that was not committed clears itself after FENCE_LIFE_MS', async () => {
            const { a, b } = servers();
            const tentative = job('tentative');
            const committed = job('committed');
            expect(await a.closeTurn(tentative, T, 0, 5000)).toBe(true);
            expect(await a.closeTurn(committed, T, 0, 5000)).toBe(true);
            expect(await a.commitFence(committed, T, 5000)).toBe(true);
            // delayed finalization: well beyond the life of a fence
            expect(await b.noteAccepted(tentative, 5000 + FENCE_LIFE_MS + 1, T)).toBe(true);
            for (const after of [1, FENCE_LIFE_MS, FENCE_LIFE_MS + 1, 2 * FENCE_LIFE_MS, LATE]) expect(await b.noteAccepted(committed, 5000 + after, T), String(after)).toBe(false);
            // and the other server's call, taken up before the commit's moment, is no matter: the field is what counts
            expect(await a.noteAccepted(committed, 5000 + LATE, T)).toBe(false);
        });

        it('leaves an unrelated new turn, another run and another job alone, and keeps the short life for a call whose turn is not known', async () => {
            const { a, b } = servers();
            const j = job('committed-others');
            expect(await a.closeTurn(j, T, 0, 5000)).toBe(true);
            expect(await a.commitFence(j, T, 5000)).toBe(true);
            // the next turn of the same run, and the same turn of another run: eligible
            expect(await b.noteAccepted(j, 5100, { turn: 7, run: 'r' })).toBe(true);
            expect(await b.noteAccepted(j, 5100, { turn: 6, run: 'other' })).toBe(true);
            // a call whose turn is not known reads the fence as any other: refused within FENCE_LIFE_MS, taken up after (as ruled)
            expect(await b.noteAccepted(j, 5000 + FENCE_LIFE_MS, undefined)).toBe(false);
            expect(await b.noteAccepted(j, 5000 + FENCE_LIFE_MS + 1, undefined)).toBe(true);
            // a job that was not given up takes its call
            expect(await b.noteAccepted(job('committed-other-job'), 5100, T)).toBe(true);
        });

        it('commits the fence of exactly the close that wrote it, and says no to a field that holds another moment or none (taken back, expired, a later close)', async () => {
            const { a } = servers();
            const j = job('commit-moment');
            expect(await a.commitFence(j, T, 5000)).toBe(false);
            expect(await a.closeTurn(j, T, 0, 5000)).toBe(true);
            // a later close of the turn wrote its own moment over it: the first close's commit is no commit of that fence
            expect(await a.closeTurn(j, T, 0, 5001)).toBe(true);
            expect(await a.commitFence(j, T, 5000)).toBe(false);
            expect(await client.hGet(CALLED_PREFIX + j, 'fence:6|r')).toBe('5001');
            expect(await a.commitFence(j, T, 5001)).toBe(true);
            expect(await client.hGet(CALLED_PREFIX + j, 'fence:6|r')).toBe('5001c');
            // the same answer to say twice
            expect(await a.commitFence(j, T, 5001)).toBe(true);
            expect(await client.hGet(CALLED_PREFIX + j, 'fence:6|r')).toBe('5001c');
            // a fence that was taken back is no fence to commit
            const taken = job('commit-taken');
            expect(await a.closeTurn(taken, T, 0, 7000)).toBe(true);
            await a.retractFence(taken, T, 7000);
            expect(await a.commitFence(taken, T, 7000)).toBe(false);
            expect(await client.hExists(CALLED_PREFIX + taken, 'fence:6|r')).toBe(false);
        });

        it('renews the hash for its full keep when it commits', async () => {
            const { a } = servers();
            const j = job('commit-ttl');
            expect(await a.closeTurn(j, T, 0, 5000)).toBe(true);
            await client.expire(CALLED_PREFIX + j, 5);
            expect(await client.ttl(CALLED_PREFIX + j)).toBeLessThanOrEqual(5);
            expect(await a.commitFence(j, T, 5000)).toBe(true);
            expect(await client.ttl(CALLED_PREFIX + j)).toBeGreaterThan(3000);
        });

        it('is never retracted: a retraction of the moment the close wrote leaves a committed fence, and a close that comes later never writes a tentative one over it', async () => {
            const { a, b } = servers();
            const j = job('commit-no-retract');
            expect(await a.closeTurn(j, T, 0, 5000)).toBe(true);
            expect(await a.commitFence(j, T, 5000)).toBe(true);
            await a.retractFence(j, T, 5000);
            expect(await client.hGet(CALLED_PREFIX + j, 'fence:6|r')).toBe('5000c');
            expect(await b.noteAccepted(j, 5000 + LATE, T)).toBe(false);
            // another close of the same turn and run (it is already given up): stands as it is
            expect(await a.closeTurn(j, T, 0, 9000)).toBe(true);
            expect(await client.hGet(CALLED_PREFIX + j, 'fence:6|r')).toBe('5000c');
            await a.retractFence(j, T, 9000);
            expect(await b.noteAccepted(j, 9000 + LATE, T)).toBe(false);
        });

        it('is taken back once the finish is accepted, and only the committed fence of that moment: the turn takes calls again, a fence of a later moment or another turn stays, and it is safe to say twice', async () => {
            const { a, b } = servers();
            const j = job('release');
            expect(await a.closeTurn(j, T, 0, 5000)).toBe(true);
            // not committed yet: nothing to release
            await a.releaseFence(j, T, 5000);
            expect(await client.hGet(CALLED_PREFIX + j, 'fence:6|r')).toBe('5000');
            expect(await a.commitFence(j, T, 5000)).toBe(true);
            // another moment, another turn, another run: nothing goes
            await a.releaseFence(j, T, 4999);
            await a.releaseFence(j, { turn: 7, run: 'r' }, 5000);
            await a.releaseFence(j, { turn: 6, run: 'other' }, 5000);
            expect(await b.noteAccepted(j, 5000 + LATE, T)).toBe(false);
            await a.releaseFence(j, T, 5000);
            await a.releaseFence(j, T, 5000);
            expect(await client.hExists(CALLED_PREFIX + j, 'fence:6|r')).toBe(false);
            expect(await b.noteAccepted(j, 5000 + LATE, T)).toBe(true);
        });

        it('keeps the fence of a close of a turn that was not known to its short life: it is not committed, and a call after FENCE_LIFE_MS is taken up', async () => {
            const { a, b } = servers();
            const j = job('commit-unknown');
            expect(await a.closeTurn(j, undefined, 0, 5000)).toBe(true);
            expect(await b.noteAccepted(j, 5000 + FENCE_LIFE_MS + 1, T)).toBe(true);
        });

        it('shows the old reading for a call that arrives before the commit: an acceptance first makes the close say no, a commit first makes the acceptance say no (both orderings)', async () => {
            const { a, b } = servers();
            const first = job('order-accept-first');
            expect(await b.noteAccepted(first, 4000, T)).toBe(true);
            expect(await a.closeTurn(first, T, 3000, 5000)).toBe(false);
            const second = job('order-close-first');
            expect(await a.closeTurn(second, T, 3000, 5000)).toBe(true);
            expect(await a.commitFence(second, T, 5000)).toBe(true);
            expect(await b.noteAccepted(second, 5001, T)).toBe(false);
        });
    });
});
