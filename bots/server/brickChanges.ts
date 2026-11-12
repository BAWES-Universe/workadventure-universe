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
