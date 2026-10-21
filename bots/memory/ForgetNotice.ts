/**
 * Who Orbit asked the bot server to forget (Hide bot conversations, #435: a manager pressed Forget on a private bot).
 * Orbit sends it with the privacy check (every 30 seconds) and with a memory save. It deleted these people already
 * and skips them in saves, so the bot server must drop them from what it holds or it would save them again.
 */
export interface MemoryForgetNotice {
    everyone: boolean;
    userUuids: string[];
}

export type MemoryForgetHandler = (botId: string, notice: MemoryForgetNotice) => void;

/**
 * Read the `forget` part of an Orbit answer. A missing or malformed one is no notice (how every answer was before),
 * as is one that names nobody.
 */
export function parseForgetNotice(forget: unknown): MemoryForgetNotice | null {
    if (!forget || typeof forget !== 'object') return null;
    const { everyone, userUuids } = forget as { everyone?: unknown; userUuids?: unknown };
    const notice: MemoryForgetNotice = {
        everyone: everyone === true,
        userUuids: Array.isArray(userUuids) ? userUuids.filter((uuid): uuid is string => typeof uuid === 'string') : [],
    };
    return notice.everyone || notice.userUuids.length > 0 ? notice : null;
}
