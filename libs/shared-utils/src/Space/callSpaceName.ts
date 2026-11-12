/**
 * A call with a bot (game #2004) happens in a private space of its own, with two members: the person who called and
 * the bot. The name says which bot and which person, so the server can tell, from the name alone, the only two
 * sockets that may join it (see checkSpaceJoin in the pusher). The parts are written in hexadecimal, so the name only
 * has letters, digits and "_" and no part can ever look like another (no "#" either: that is for bubbles).
 */
export const CALL_SPACE_PREFIX = "call__";

export interface CallSpaceParts {
    /** The bot being called (the id its token carries after "bot-"). */
    botId: string;
    /** The player who called: their uuid as the game knows it. */
    callerUuid: string;
    /** Tells this call from the same person's earlier calls with the same bot. */
    callId: string;
}

const encode = (value: string): string =>
    Array.from(new TextEncoder().encode(value), (byte) => byte.toString(16).padStart(2, "0")).join("");

function decode(hex: string): string | undefined {
    if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/.test(hex)) return undefined;
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
        return undefined;
    }
}

export function callSpaceName({ botId, callerUuid, callId }: CallSpaceParts): string {
    return `${CALL_SPACE_PREFIX}${encode(botId)}_${encode(callerUuid)}_${encode(callId)}`;
}

export function isCallSpaceName(spaceName: string): boolean {
    return spaceName.startsWith(CALL_SPACE_PREFIX);
}

/** Who a call space is for, or undefined when the name is not exactly one that callSpaceName makes. */
export function parseCallSpaceName(spaceName: string): CallSpaceParts | undefined {
    if (!isCallSpaceName(spaceName)) return undefined;
    const parts = spaceName.slice(CALL_SPACE_PREFIX.length).split("_");
    if (parts.length !== 3) return undefined;
    const [botId, callerUuid, callId] = parts.map(decode);
    if (botId === undefined || callerUuid === undefined || callId === undefined) return undefined;
    const parsed = { botId, callerUuid, callId };
    return callSpaceName(parsed) === spaceName ? parsed : undefined;
}

/** What a bot's sign-in token calls it: the id of a bot is what comes after this. */
export const BOT_IDENTIFIER_PREFIX = "bot-";
