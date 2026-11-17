/**
 * Who else is in each space a bot is in (game #1993).
 *
 * "A group" means anyone else in the same bubble or meeting room: a person, a guest or another bot. Room membership
 * only, never distance and never who is nearest. `BotAttention` counts people alone, to tell whose words are the bot's;
 * this counts everyone, to tell who would read a reply.
 *
 * One instance per bot. `BotClient` feeds it what the game says about a space, and leaves out the bot itself.
 */
import { SOMEONE_UNKNOWN } from '../memory/Heard';

export class SpaceAudience {
    /** By space, then by space user id: who that is. */
    private readonly spaces = new Map<string, Map<string, string>>();

    /**
     * Someone is in the space. Who they are is their uuid, the same for a person wherever they are met; someone the game
     * gives no uuid for cannot be told from anyone else, so nothing is ever open to them.
     */
    joined(spaceName: string, user: { spaceUserId?: string; uuid?: string }): void {
        if (!user.spaceUserId) return;
        let members = this.spaces.get(spaceName);
        if (!members) this.spaces.set(spaceName, (members = new Map()));
        members.set(user.spaceUserId, user.uuid?.trim() || SOMEONE_UNKNOWN);
    }

    /** The game's list of who is in a space the bot just joined. An empty list still says the bot sees the space. */
    seen(spaceName: string, users: ReadonlyArray<{ spaceUserId?: string; uuid?: string }>): void {
        if (!this.spaces.has(spaceName)) this.spaces.set(spaceName, new Map());
        for (const user of users) this.joined(spaceName, user);
    }

    left(spaceName: string, spaceUserId: string | undefined): void {
        if (spaceUserId) this.spaces.get(spaceName)?.delete(spaceUserId);
    }

    /** The bot left the space: it no longer sees who is there. */
    spaceLeft(spaceName: string): void {
        this.spaces.delete(spaceName);
    }

    reset(): void {
        this.spaces.clear();
    }

    /**
     * Everyone in the space but those `except` picks out (the bot, and the person a reply is for), by who they are.
     * Undefined when the bot has been told nothing about the space: it cannot say who is there.
     */
    others(spaceName: string, except: (spaceUserId: string) => boolean): string[] | undefined {
        const members = this.spaces.get(spaceName);
        if (!members) return undefined;
        const others: string[] = [];
        for (const [spaceUserId, who] of members) {
            if (!except(spaceUserId)) others.push(who);
        }
        return others;
    }
}
