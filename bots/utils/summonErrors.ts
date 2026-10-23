/**
 * Why a Summon was refused, as errors the API can tell apart. The game shows a different line for each.
 */

/**
 * The bot is with someone (chatting, leading, or already called over) and cannot be called away. `withYou` is true
 * when that someone is the player asking, so the game can say the bot is already with them.
 */
export class BotBusyError extends Error {
    constructor(
        readonly withYou = false,
        message = 'Bot is currently engaged with another player and cannot be summoned'
    ) {
        super(message);
        this.name = 'BotBusyError';
    }
}

/** The bot is not in the room right now: not spawned, or spawned but not connected yet. */
export class BotUnavailableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'BotUnavailableError';
    }
}
