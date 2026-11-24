import { createClient } from 'redis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import { takeTurnOnInbox } from './helpers/sharedInboxLock';

/** The turn the test files that use the Matrix inbox take (they share one set in the shared Redis): one holder at a time, and a turn that ran out is never given back by its old holder. */
const URL = process.env.BOTS_TEST_REDIS_URL;
describe.runIf(!!URL)('the turn on the shared inbox (a real Redis)', () => {
    const client = createClient({ url: URL });
    // a key of this file's own: the lock the inbox files share may be taken by one of them at any moment, and none of what is checked here depends on it
    const KEY = `test:inbox-turn-helper-${randomUUID()}`;
    const take = (waitMs?: number) => takeTurnOnInbox(client as never, waitMs, KEY);
    beforeAll(async () => {
        await client.connect();
    });
    afterAll(async () => {
        await client.del(KEY);
        await client.quit();
    });

    it('a second file waits until the first has given the turn back, and then has it', async () => {
        const giveBackFirst = await take();
        const order: string[] = [];
        const second = take().then((giveBack) => {
            order.push('second has it');
            return giveBack;
        });
        await new Promise((resolve) => setTimeout(resolve, 150));
        expect(order).toEqual([]);
        order.push('first gives it back');
        await giveBackFirst();
        const giveBackSecond = await second;
        expect(order).toEqual(['first gives it back', 'second has it']);
        await giveBackSecond();
        expect(await client.get(KEY)).toBeNull();
    }, 330_000);

    it('a holder whose turn ran out does not take the turn of the file that has it now', async () => {
        const giveBackOld = await take();
        // the turn ends by itself and another file takes it
        await client.del(KEY);
        const giveBackNew = await take();
        await giveBackOld();
        expect(await client.get(KEY)).not.toBeNull();
        await giveBackNew();
        expect(await client.get(KEY)).toBeNull();
    }, 330_000);

    it('gives up after the wait it was given, rather than hang for ever', async () => {
        const giveBack = await take();
        await expect(take(120)).rejects.toThrow(/too long/);
        await giveBack();
    }, 330_000);
});
