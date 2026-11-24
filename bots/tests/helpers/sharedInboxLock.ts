import { randomUUID } from 'crypto';

/**
 * Test files that use the durable Matrix inbox share ONE sorted set in the shared Redis (`matrix:inbox`): a scan in one file takes over the stale entries of the other, counts its entries
 * as its own, and a clean-up deletes the set under it. Vitest runs files side by side, so a file takes its turn on the inbox here: one holder at a time, whichever process it is in. The lock
 * ends by itself after a few minutes, so a file that died holding it never blocks the rest.
 */
export const INBOX_TURN_KEY = 'test:matrix-inbox-turn';
const TURN_LASTS_MS = 5 * 60_000;

/** Deletes the lock only while it is still the holder's own token: one step, so a lock that ran out and was taken by another file between a read and a delete is never removed. */
export const GIVE_TURN_BACK = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
`;

type Client = {
    set(key: string, value: string, options: { NX: true; PX: number }): Promise<string | null>;
    eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
};

/**
 * Waits for the turn and returns what gives it back. `key` names the lock: the default is the one every inbox file shares; a test of this helper names a key of its own, so another file
 * taking the shared one at that moment changes nothing it checks.
 */
export async function takeTurnOnInbox(client: Client, waitMs = TURN_LASTS_MS, key = INBOX_TURN_KEY): Promise<() => Promise<void>> {
    const token = randomUUID();
    const until = Date.now() + waitMs;
    for (;;) {
        // eslint-disable-next-line no-await-in-loop
        if ((await client.set(key, token, { NX: true, PX: TURN_LASTS_MS })) === 'OK') break;
        if (Date.now() > until) throw new Error('Another test file kept its turn on the Matrix inbox for too long');
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return async () => {
        await client.eval(GIVE_TURN_BACK, { keys: [key], arguments: [token] });
    };
}
