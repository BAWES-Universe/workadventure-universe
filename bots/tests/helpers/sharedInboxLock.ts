import { randomUUID } from 'crypto';

/**
 * Test files that use the durable Matrix inbox share ONE sorted set in the shared Redis (`matrix:inbox`): a scan in one file takes over the stale entries of the other, counts its entries
 * as its own, and a clean-up deletes the set under it. Vitest runs files side by side, so a file takes its turn on the inbox here: one holder at a time, whichever process it is in. The lock
 * ends by itself after a few minutes, so a file that died holding it never blocks the rest.
 */
export const INBOX_TURN_KEY = 'test:matrix-inbox-turn';
const TURN_LASTS_MS = 5 * 60_000;

type Client = {
    set(key: string, value: string, options: { NX: true; PX: number }): Promise<string | null>;
    get(key: string): Promise<string | null>;
    del(key: string): Promise<number>;
};

/** Waits for the turn and returns what gives it back. */
export async function takeTurnOnInbox(client: Client, waitMs = TURN_LASTS_MS): Promise<() => Promise<void>> {
    const token = randomUUID();
    const until = Date.now() + waitMs;
    for (;;) {
        // eslint-disable-next-line no-await-in-loop
        if ((await client.set(INBOX_TURN_KEY, token, { NX: true, PX: TURN_LASTS_MS })) === 'OK') break;
        if (Date.now() > until) throw new Error('Another test file kept its turn on the Matrix inbox for too long');
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return async () => {
        // only the holder gives it back (a turn that ran out and was taken by another file stays that file's)
        if ((await client.get(INBOX_TURN_KEY)) === token) await client.del(INBOX_TURN_KEY);
    };
}
