import { createClient } from 'redis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INBOX_TURN_KEY, takeTurnOnInbox } from './helpers/sharedInboxLock';

/** The turn the test files that use the Matrix inbox take (they share one set in the shared Redis): one holder at a time, and a turn that ran out is never given back by its old holder. */
const URL = process.env.BOTS_TEST_REDIS_URL;
describe.runIf(!!URL)('the turn on the shared inbox (a real Redis)', () => {
    const client = createClient({ url: URL });
    beforeAll(async () => {
        await client.connect();
    });
    afterAll(async () => {
        await client.quit();
    });

    it('a second file waits until the first has given the turn back, and then has it', async () => {
        // the shared key is the real one used by the other files: wait for their turn to end first
        const giveBackFirst = await takeTurnOnInbox(client as never);
        const order: string[] = [];
        const second = takeTurnOnInbox(client as never).then((giveBack) => {
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
        expect(await client.get(INBOX_TURN_KEY)).toBeNull();
    }, 330_000);

    it('a holder whose turn ran out does not take the turn of the file that has it now', async () => {
        const giveBackOld = await takeTurnOnInbox(client as never);
        // the turn ends by itself and another file takes it
        await client.del(INBOX_TURN_KEY);
        const giveBackNew = await takeTurnOnInbox(client as never);
        await giveBackOld();
        expect(await client.get(INBOX_TURN_KEY)).not.toBeNull();
        await giveBackNew();
        expect(await client.get(INBOX_TURN_KEY)).toBeNull();
    }, 330_000);

    it('gives up after the wait it was given, rather than hang for ever', async () => {
        const giveBack = await takeTurnOnInbox(client as never);
        await expect(takeTurnOnInbox(client as never, 120)).rejects.toThrow(/too long/);
        await giveBack();
    }, 330_000);
});
