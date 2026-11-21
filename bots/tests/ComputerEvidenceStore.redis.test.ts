import { createClient } from 'redis';
import { describe, expect, it } from 'vitest';
import { RedisSharedCalls } from '../server/ComputerEvidenceStore';

// Runs the two Lua scripts of the fence against a real Redis, when one is named (`REDIS_TEST_URL=redis://127.0.0.1:6379`); the unit tests run their JavaScript
// equivalents in memory. It flushes the database it is given: point it at a scratch one.
describe.skipIf(!process.env.REDIS_TEST_URL)('the fence of a turn, on a real Redis', () => {
    it('closes a turn only when no other server took up a call of it, and refuses a call for a turn that was closed (the same answers as the in-memory fakes)', async () => {
        const client = createClient({ url: process.env.REDIS_TEST_URL });
        await client.connect();
        await client.flushAll();
        const a = new RedisSharedCalls(() => client as never, 'A');
        const b = new RedisSharedCalls(() => client as never, 'B');
        const c = new RedisSharedCalls(() => client as never, 'C');
        // B takes up a call of turn 5 run r at 1000; A tries to close turn 5 from 500
        expect(await b.noteAccepted('j', 1000, { turn: 5, run: 'r' })).toBe(true);
        expect(await a.closeTurn('j', { turn: 5, run: 'r' }, 500, 2000)).toBe(false);
        // an acceptance for another turn does not count
        expect(await a.closeTurn('j', { turn: 6, run: 'r' }, 500, 2000)).toBe(true);
        // after the fence for 6 B's acceptance for 6 is refused, for 5 and 7 is not
        expect(await b.noteAccepted('j', 2100, { turn: 6, run: 'r' })).toBe(false);
        expect(await b.noteAccepted('j', 2100, { turn: 7, run: 'r' })).toBe(true);
        expect(await c.noteAccepted('j', 2100, { turn: 6, run: 'other' })).toBe(true);
        // unknown turn: refused within 10 s of a fence, accepted later
        expect(await b.noteAccepted('j', 2200)).toBe(false);
        expect(await b.noteAccepted('j', 2000 + 10_001)).toBe(true);
        // old acceptance (before from-skew) does not count
        await client.flushAll();
        await b.noteAccepted('k', 100, { turn: 1 });
        expect(await a.closeTurn('k', { turn: 1 }, 5000, 6000)).toBe(true);
        // unknown turn acceptance counts for every turn
        await client.flushAll();
        await b.noteAccepted('m', 5);
        expect(await a.closeTurn('m', { turn: 3, run: 'x' }, 0, 10)).toBe(false);
        // own instance acceptance is not read
        await client.flushAll();
        await a.noteAccepted('n', 1000, { turn: 1 });
        expect(await a.closeTurn('n', { turn: 1 }, 0, 2000)).toBe(true);
        // lastCalledByOthers skips fence fields
        expect(await b.lastCalledByOthers('n')).toBeNull();
        await client.quit();
    });
});
