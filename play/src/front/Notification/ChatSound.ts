/**
 * The chat sound this page played, by chat, so the service worker can show a pushed notification of the same message
 * without the system's sound (#1493): one sound per message, ours. A push for a message this page did not ring for
 * keeps the system's sound.
 */

/** A push comes a moment after the message reaches the page: a sound this recent was for the same message. */
export const PLAYED_WITHIN_MS = 5_000;
/** A push can also come first: the page waits this long for its own sound before saying it played none. */
export const WAIT_FOR_SOUND_MS = 1_500;

const playedAt = new Map<string, number>();
const waiting = new Map<string, Set<() => void>>();

/** The chat sound just played for a message in this chat. */
export function chatSoundPlayed(chatRoomId: string, now = Date.now()): void {
    playedAt.set(chatRoomId, now);
    const waiters = waiting.get(chatRoomId);
    waiting.delete(chatRoomId);
    waiters?.forEach((wake) => wake());
}

/** Whether this page plays (or just played) the chat sound for the newest message in this chat. */
export function playsChatSound(
    chatRoomId: string,
    now = Date.now(),
    waitMs: number = WAIT_FOR_SOUND_MS
): Promise<boolean> {
    const at = playedAt.get(chatRoomId);
    if (at !== undefined && now - at < PLAYED_WITHIN_MS) return Promise.resolve(true);
    return new Promise((resolve) => {
        const waiters = waiting.get(chatRoomId) ?? new Set<() => void>();
        waiting.set(chatRoomId, waiters);
        const wake = () => {
            clearTimeout(timer);
            resolve(true);
        };
        const timer = setTimeout(() => {
            waiters.delete(wake);
            if (waiters.size === 0 && waiting.get(chatRoomId) === waiters) waiting.delete(chatRoomId);
            resolve(false);
        }, waitMs);
        waiters.add(wake);
    });
}
