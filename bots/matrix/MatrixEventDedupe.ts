import { randomUUID } from 'crypto';
import type { EvidenceRedis } from '../server/ComputerEvidenceStore';

/** How long the id of an event that was handled is remembered: Matrix sends a transaction again for far less, and a restart finds its events again within minutes. */
export const EVENT_SEEN_SECONDS = 24 * 60 * 60;
export const EVENT_SEEN_PREFIX = 'matrix:event:';
/** How long a claim of an event still being handled lives with nobody renewing it: a server that died holds an event no longer than this, and a copy that comes after it is handled. */
export const EVENT_HANDLING_SECONDS = 5 * 60;
/** How often a claim of a handler that is still working is renewed (well inside its life), and for how long at most (a handler that takes longer than this has hung: its claim then expires). */
export const EVENT_RENEW_EVERY_MS = 60 * 1000;
export const EVENT_RENEW_FOR_MS = 30 * 60 * 1000;
/** How long the shared store has to answer: a store that is connected but does not answer must not hold the room (the router waits for this before it handles anything of the room). */
export const EVENT_STORE_DEADLINE_MS = 3000;

/** One step in the shared store: set the key only when nobody holds it, for the time a handler takes (`SET NX PX`). `1` for the first to ask, `0` for any other. */
const CLAIM = `
if redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', tonumber(ARGV[2])) then
  return 1
end
return 0
`;
/** The handler finished: the claim becomes "handled" for a day, only when it is still THIS handler's (a handler that outlived its claim never touches another server's). */
const FINISH = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('SET', KEYS[1], 'd', 'EX', tonumber(ARGV[2]))
  return 1
end
return 0
`;
/** The handler is still working: its claim lives on, only when it is still THIS handler's. */
const RENEW = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]))
  return 1
end
return 0
`;

/** The claim of an event this server took in: it ends when the handler has finished (it never throws). */
export interface EventClaim {
    finish(): Promise<void>;
}

/** One id for this process: the claims it holds say which server holds them. */
const SERVER = randomUUID().slice(0, 8);

/**
 * Whether this server may handle this Matrix event, decided in the shared store (Redis) so the same event delivered to two servers, or to a server that restarted, is handled once.
 * It is two steps, as the event is acknowledged to Matrix before it is handled: a server CLAIMS the event (`p`, for a few minutes, renewed while its handler works), and marks it
 * handled (`d`, for a day) when the handler is over, whether it finished or threw (a handler that threw has already logged it and may have used a paid turn: another copy must not
 * run it again). A server that died in the middle never marks it, and its claim runs out: a copy that comes after that is handled, never skipped for a day. Every step that changes a
 * claim acts only while the claim is still this handler's. It is the fast path: the key of a computer start is made from the event, which is the guarantee when this cannot say. With the
 * store down or slow it hands out a claim that touches nothing (the event is handled), never `false`.
 *
 * Returns `false` when the event is taken in (being handled, or handled) and must not be handled again.
 */
export function createEventDedupe(
    client: () => Pick<EvidenceRedis, 'eval'> | null,
    ttlSeconds = EVENT_SEEN_SECONDS,
    options: { handlingSeconds?: number; deadlineMs?: number; renewEveryMs?: number; renewForMs?: number } = {}
): (eventId: string) => Promise<false | EventClaim> {
    const handlingMs = (options.handlingSeconds ?? EVENT_HANDLING_SECONDS) * 1000;
    const deadlineMs = options.deadlineMs ?? EVENT_STORE_DEADLINE_MS;
    const renewEveryMs = options.renewEveryMs ?? EVENT_RENEW_EVERY_MS;
    const renewForMs = options.renewForMs ?? EVENT_RENEW_FOR_MS;
    const nothing: EventClaim = { finish: async () => undefined };
    /** One step in the store against a deadline that rejects: a store that never answers is the same as one that fails. */
    const step = async (redis: Pick<EvidenceRedis, 'eval'>, script: string, key: string, args: string[]): Promise<unknown> => {
        let timer: NodeJS.Timeout | undefined;
        try {
            const late = new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error('Shared store did not answer in time')), deadlineMs);
                timer.unref?.();
            });
            return await Promise.race([redis.eval(script, { keys: [key], arguments: args }), late]);
        } finally {
            clearTimeout(timer);
        }
    };
    return async (eventId) => {
        if (!eventId) return nothing;
        const redis = client();
        if (!redis) return nothing;
        const key = `${EVENT_SEEN_PREFIX}${eventId}`;
        const token = `p:${SERVER}:${randomUUID()}`;
        try {
            const first = await step(redis, CLAIM, key, [token, String(handlingMs)]);
            if (first === 0 || first === '0') return false;
        } catch (error) {
            console.warn('[MatrixAppService] Could not remember an event in the shared store; it is handled:', error instanceof Error ? error.message : error);
            return nothing;
        }
        // While the handler works the claim is renewed, so a handler that takes long (a long model turn) is never run a second time by a copy that comes after the first claim's life
        const began = Date.now();
        const heartbeat = setInterval(() => {
            if (Date.now() - began >= renewForMs) {
                clearInterval(heartbeat);
                return;
            }
            void step(redis, RENEW, key, [token, String(handlingMs)]).catch(() => undefined);
        }, renewEveryMs);
        heartbeat.unref?.();
        let finished = false;
        return {
            finish: async () => {
                if (finished) return;
                finished = true;
                clearInterval(heartbeat);
                await step(redis, FINISH, key, [token, String(ttlSeconds)]).catch((error) => {
                    console.warn('[MatrixAppService] Could not mark an event as handled; its claim runs out by itself:', error instanceof Error ? error.message : error);
                });
            },
        };
    };
}
