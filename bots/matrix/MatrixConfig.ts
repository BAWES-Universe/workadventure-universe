/**
 * Settings for the Matrix application service that lets people message bots directly.
 *
 * Bots get Matrix accounts named @bot_<botId>:<domain>. Synapse creates them on first use and pushes every event
 * for them to the bot server, so an idle bot costs one user row on the homeserver and nothing here.
 * When any of the four values is missing, direct messages to bots are off and nothing else changes.
 */
export interface MatrixAppServiceConfig {
    /** Client-server API base URL the bot server calls, e.g. http://synapse:8008 */
    homeserverUrl: string;
    /** Server name in Matrix IDs, e.g. matrix.bawes.net */
    domain: string;
    /** Token the bot server presents to Synapse (as_token in the registration file) */
    asToken: string;
    /** Token Synapse presents to the bot server (hs_token in the registration file) */
    hsToken: string;
}

export const BOT_LOCALPART_PREFIX = 'bot_';

// Matrix localparts allow only lowercase letters, digits and ._=-/ (Orbit bot ids are lowercase uuids).
const LOCALPART_SAFE = /^[a-z0-9._=\-/]+$/;

export function readMatrixConfig(env: NodeJS.ProcessEnv = process.env): MatrixAppServiceConfig | null {
    const homeserverUrl = env.MATRIX_HOMESERVER_URL?.trim().replace(/\/+$/, '');
    const domain = env.MATRIX_DOMAIN?.trim();
    const asToken = env.MATRIX_AS_TOKEN?.trim();
    const hsToken = env.MATRIX_HS_TOKEN?.trim();
    if (!homeserverUrl || !domain || !asToken || !hsToken) return null;
    return { homeserverUrl, domain, asToken, hsToken };
}

/** The Matrix ID of a bot, or undefined when its id cannot be a Matrix localpart. */
export function botMatrixId(domain: string, botId: string): string | undefined {
    if (!LOCALPART_SAFE.test(botId)) return undefined;
    return `@${BOT_LOCALPART_PREFIX}${botId}:${domain}`;
}

/** The bot id inside a Matrix ID from our namespace, or null for anyone else. */
export function botIdFromMatrixId(domain: string, userId: string): string | null {
    const prefix = `@${BOT_LOCALPART_PREFIX}`;
    const suffix = `:${domain}`;
    if (!userId.startsWith(prefix) || !userId.endsWith(suffix)) return null;
    const botId = userId.slice(prefix.length, userId.length - suffix.length);
    return botId && LOCALPART_SAFE.test(botId) ? botId : null;
}
