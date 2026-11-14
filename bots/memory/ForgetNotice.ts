/**
 * Who Orbit asked the bot server to forget (Hide bot conversations, #435: a manager pressed Forget on a private bot).
 * Orbit sends it with the privacy check (every 30 seconds) and with a memory save. It deleted these people already
 * and skips them in saves, so the bot server must drop them from what it holds or it would save them again.
 */
export interface MemoryForgetNotice {
    everyone: boolean;
    userUuids: string[];
    /**
     * Each Forget behind the notice, by its id (`userUuid` null is everyone). Orbit repeats a Forget for a minute, so
     * the id is what tells a repeat from a second Forget of the same person. An Orbit that does not send them yet
     * leaves this out.
     */
    rows?: { id: string; userUuid: string | null }[];
}

export type MemoryForgetHandler = (botId: string, notice: MemoryForgetNotice) => void;

/**
 * Read the `forget` part of an Orbit answer. A missing or malformed one is no notice (how every answer was before),
 * as is one that names nobody.
 */
export function parseForgetNotice(forget: unknown): MemoryForgetNotice | null {
    if (!forget || typeof forget !== 'object') return null;
    const { everyone, userUuids, rows } = forget as { everyone?: unknown; userUuids?: unknown; rows?: unknown };
    const notice: MemoryForgetNotice = {
        everyone: everyone === true,
        userUuids: Array.isArray(userUuids) ? userUuids.filter((uuid): uuid is string => typeof uuid === 'string') : [],
    };
    if (Array.isArray(rows)) {
        notice.rows = rows.flatMap((row) => {
            const { id, userUuid } = (row ?? {}) as { id?: unknown; userUuid?: unknown };
            if (typeof id !== 'string' || (userUuid !== null && typeof userUuid !== 'string')) return [];
            return [{ id, userUuid: userUuid as string | null }];
        });
    }
    return notice.everyone || notice.userUuids.length > 0 ? notice : null;
}

/**
 * One thing a person forgot through Orbit (their list there, or "forget that" said in the chat), by its key (#2003).
 * Orbit sends these with a memory save and with the privacy check until the bot server reports it dropped the thing.
 */
export interface ItemForgetNotice {
    id: string;
    userUuid: string;
    itemKey: string;
    /** When it was forgotten (milliseconds). What the person said again after this stays. */
    at: number;
}

export type ItemForgetHandler = (botId: string, items: ItemForgetNotice[]) => void;

/** Read the `forgetItems` part of an Orbit answer. A missing or malformed one is no notice, as is an entry that is not whole. */
export function parseItemForgets(value: unknown): ItemForgetNotice[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry) => {
        const { id, userUuid, itemKey, at } = (entry ?? {}) as Record<string, unknown>;
        if (typeof id !== 'string' || typeof userUuid !== 'string' || typeof itemKey !== 'string' || itemKey === '') return [];
        return [{ id, userUuid, itemKey, at: typeof at === 'number' && Number.isFinite(at) && at > 0 ? at : 0 }];
    });
}
