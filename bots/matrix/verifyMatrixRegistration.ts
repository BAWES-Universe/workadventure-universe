import * as Sentry from '@sentry/node';
import { markMatrixRejected, type MatrixAppServiceConfig } from './MatrixConfig';
import type { MatrixAppServiceClient } from './MatrixAppServiceClient';

/** Waits between tries while Synapse may still be starting: about a minute in all, so startup is never held longer. */
const RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 15_000, 15_000, 15_000];

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
    for (let attempt = 0; ; attempt++) {
        const answer = await client.whoami().catch(() => null);
        if (answer?.ok) {
            if (answer.userId.endsWith(`:${config.domain}`)) {
                console.log('[BotServer] Matrix registration verified');
                return true;
            }
            return reject(MATRIX_REJECTED_MESSAGE, `Synapse answered as ${answer.userId}, not on ${config.domain}`);
        }
        // Not reachable yet, or Synapse still starting: try again. Any other answer is a registration it refuses.
        if (answer && answer.status < 500) {
            return reject(MATRIX_REJECTED_MESSAGE, `${answer.status} ${answer.errcode ?? ''}`.trim());
        }
        if (attempt >= RETRY_DELAYS_MS.length) return reject(MATRIX_UNREACHABLE_MESSAGE, 'no answer after retries');
        await wait(RETRY_DELAYS_MS[attempt]);
    }
}

function reject(message: string, detail: string): false {
    console.error(`${message} (${detail})`);
    Sentry.captureMessage(message, { level: 'error', extra: { detail } });
    markMatrixRejected(message);
    return false;
}
