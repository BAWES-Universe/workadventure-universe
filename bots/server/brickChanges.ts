import type { BotRegistry } from './BotRegistry';

/**
 * What the bot server does when an owner says their Brick changed (#1996): it drops its own copy now, and tells every
 * other bot server to do the same, so a deleted Brick stops at once on all of them, not only on the one the owner's
 * device reached. Each server drops the Brick only when it holds it as that same owner's. Telling the others can
 * fail without failing the owner: they then read the Brick again within the minute their copy lasts.
 */
export function brickChangedEverywhere(
    registry: Pick<BotRegistry, 'tellBrickChanged'>,
    forget: (botId: string, ownerId: string) => boolean
): (botId: string, ownerId: string) => boolean {
    return (botId, ownerId) => {
        Promise.resolve()
            .then(() => registry.tellBrickChanged(botId, ownerId))
            .catch((error) => console.warn(`[BotServer] Could not tell the other bot servers that Brick ${botId} changed:`, error));
        return forget(botId, ownerId);
    };
}

/**
 * Hears Brick changes from the other bot servers (#1996). When listening cannot start (Redis busy at startup, say), it
 * is tried again, less often each time, until it starts or the server stops: meanwhile a Brick changed through another
 * server is read again here within the minute its copy lasts. Resolves after the first try; the stop ends the retries.
 */
export async function listenForBrickChanges(
    registry: Pick<BotRegistry, 'onBrickChanged'>,
    heard: (botId: string, ownerId: string) => void,
    { firstRetryMs = 1_000, maxRetryMs = 60_000 }: { firstRetryMs?: number; maxRetryMs?: number } = {}
): Promise<() => void> {
    let stopped = false;
    let timer: NodeJS.Timeout | undefined;
    const attempt = async (retryMs: number): Promise<void> => {
        try {
            await registry.onBrickChanged(heard);
        } catch (error) {
            if (stopped) return;
            console.warn(`[BotServer] Not hearing Brick changes from other bot servers, trying again in ${Math.round(retryMs / 1000)} s:`, error);
            timer = setTimeout(() => void attempt(Math.min(retryMs * 2, maxRetryMs)), retryMs);
            timer.unref?.();
        }
    };
    await attempt(firstRetryMs);
    return () => {
        stopped = true;
        if (timer) clearTimeout(timer);
    };
}
