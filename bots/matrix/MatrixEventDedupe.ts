import type { EvidenceRedis } from '../server/ComputerEvidenceStore';

/** How long the id of an event that was taken in is remembered: Matrix sends a transaction again for far less, and a restart finds its events again within minutes. */
export const EVENT_SEEN_SECONDS = 24 * 60 * 60;
export const EVENT_SEEN_PREFIX = 'matrix:event:';

/** One step in the shared store: set the key only when nobody holds it, for a day (`SET NX EX`). `1` for the first to ask, `0` for any other. */
const FIRST_TO_SEE = `
if redis.call('SET', KEYS[1], ARGV[1], 'NX', 'EX', tonumber(ARGV[2])) then
  return 1
end
return 0
`;

/**
 * Whether this is the first time ANY bot server takes in this Matrix event, remembered in the shared store (Redis) for a day, so the same event delivered to two servers, or to a
 * server that restarted, is handled once. It is the fast path: the key of a computer start is made from the event, which is the guarantee when this cannot say. With the store
 * down or slow it answers true (the event is handled), never false.
 */
export function createEventDedupe(client: () => Pick<EvidenceRedis, 'eval'> | null, ttlSeconds = EVENT_SEEN_SECONDS): (eventId: string) => Promise<boolean> {
    return async (eventId) => {
        if (!eventId) return true;
        const redis = client();
        if (!redis) return true;
        try {
            const first = await redis.eval(FIRST_TO_SEE, { keys: [`${EVENT_SEEN_PREFIX}${eventId}`], arguments: ['1', String(ttlSeconds)] });
            return first !== 0 && first !== '0';
        } catch (error) {
            console.warn('[MatrixAppService] Could not remember an event in the shared store; it is handled:', error instanceof Error ? error.message : error);
            return true;
        }
    };
}
