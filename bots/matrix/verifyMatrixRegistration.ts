import * as Sentry from '@sentry/node';
import { markMatrixRejected, type MatrixAppServiceConfig } from './MatrixConfig';
import type { MatrixAppServiceClient } from './MatrixAppServiceClient';

/** Waits between tries while Synapse may still be starting. */
const RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 15_000, 15_000, 15_000];
/** Each try gets this long, so a Synapse that hangs costs no more than one that refuses the connection. */
const ATTEMPT_TIMEOUT_MS = 5_000;
/** Startup waits on this check (map bots included), so it never takes longer than this in all. */
const DEADLINE_MS = 60_000;
/** Answers that say "not now" rather than "not you": timed out, too early, too many requests, or no route yet. */
const RETRY_STATUSES = new Set([404, 408, 425, 429]);

export const MATRIX_REJECTED_MESSAGE =
    '[BotServer] Matrix direct messages are OFF: Synapse does not accept MATRIX_AS_TOKEN (check the registration file on Synapse and MATRIX_AS_TOKEN / MATRIX_HS_TOKEN / MATRIX_DOMAIN)';
export const MATRIX_UNREACHABLE_MESSAGE =
    '[BotServer] Matrix direct messages are OFF: Synapse not reachable at MATRIX_HOMESERVER_URL (restart the bot server once it is up)';

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Asks Synapse who this bot server is before direct messages turn on. A wrong or missing registration would otherwise
 * look like everything is on (bots show Message) while every message fails. Says yes only for our own domain; anything
 * else turns direct messages off for this process, loudly, once.
 */
export async function verifyMatrixRegistration(
    client: Pick<MatrixAppServiceClient, 'whoami'>,
    config: MatrixAppServiceConfig
): Promise<boolean> {
    const deadline = Date.now() + DEADLINE_MS;
    for (let attempt = 0; ; attempt++) {
        const timeout = Math.max(1, Math.min(ATTEMPT_TIMEOUT_MS, deadline - Date.now()));
        const answer = await client.whoami(timeout).catch(() => null);
        if (answer?.ok) {
            if (answer.userId.endsWith(`:${config.domain}`)) {
                console.log('[BotServer] Matrix registration verified');
                return true;
            }
            return reject(MATRIX_REJECTED_MESSAGE, `Synapse answered as ${answer.userId}, not on ${config.domain}`);
        }
        // Not reachable yet, Synapse (or the proxy in front of it) still starting, or busy: try again. Any other answer
        // is a registration it refuses.
        if (answer && answer.status < 500 && !RETRY_STATUSES.has(answer.status)) {
            return reject(MATRIX_REJECTED_MESSAGE, `${answer.status} ${answer.errcode ?? ''}`.trim());
        }
        const delay = RETRY_DELAYS_MS[attempt];
        if (delay === undefined || Date.now() + delay >= deadline) {
            return reject(MATRIX_UNREACHABLE_MESSAGE, 'no answer after retries');
        }
        await wait(delay);
    }
}

function reject(message: string, detail: string): false {
    console.error(`${message} (${detail})`);
    Sentry.captureMessage(message, { level: 'error', extra: { detail } });
    markMatrixRejected(message);
    return false;
}
