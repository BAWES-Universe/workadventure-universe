/**
 * Who a bot's reply is delivered to (game #1993).
 *
 * A reply written for someone who is alone with the bot holds whatever the two of them share. It goes into the space
 * piece by piece, and its last piece carries all of it, so someone who walks up while it is being written would be
 * sent the whole reply. Each reply is therefore bound to its one reader when its first piece goes out, and every later
 * piece carries that reader for the game server, which delivers it to nobody else.
 *
 * Whether the person was alone is the same answer the reply was built on: the AI service says so as the turn starts,
 * before anything is written, so there is no moment between deciding what goes into a reply and deciding who gets it.
 *
 * One instance per bot.
 */

/** How many replies stay bound: more than a bot ever writes at once, with room for the marks that follow a reply. */
const MAX_BOUND = 300;
const MAX_TURNS = 500;

/** The person a reply is for, from the id the behaviours give it ("bot-<bot>-player-<id>-<uuid>"). */
export function playerOfReply(responseId: string): number | undefined {
    const at = responseId.lastIndexOf('-player-');
    if (at < 0) return undefined;
    const digits = /^\d+/.exec(responseId.slice(at + '-player-'.length));
    return digits ? Number(digits[0]) : undefined;
}

export class ReplyReaders {
    /** By space and player: whether the reply being written for them started with them alone with the bot. */
    private readonly turns = new Map<string, boolean>();
    /** By reply: its space, and its one reader's space user id, or null when it is for everyone there. */
    private readonly bound = new Map<string, { spaceName: string; reader: string | null }>();

    private static turnKey(spaceName: string, playerId: number): string {
        return `${spaceName}\n${playerId}`;
    }

    /** A reply for this person starts. `alone`: nobody else was in the space when what goes into it was decided. */
    starts(spaceName: string, playerId: number, alone: boolean): void {
        const key = ReplyReaders.turnKey(spaceName, playerId);
        this.turns.delete(key);
        this.turns.set(key, alone);
        if (this.turns.size > MAX_TURNS) this.turns.delete(this.turns.keys().next().value as string);
    }

    /**
     * The one reader of this reply, or undefined when it is for everyone in the space. Decided the first time the reply
     * is seen and kept for all of it, whoever comes or goes meanwhile.
     *
     * `now` is asked only that first time: whether the person is alone with the bot right now (used when no turn said,
     * as for a line the bot says outside a turn), and their space user id.
     */
    readerOf(spaceName: string, responseId: string, now: { alone(playerId: number): boolean; spaceUserIdOf(playerId: number): string | undefined }): string | undefined {
        const known = this.bound.get(responseId);
        if (known) return known.reader ?? undefined;
        const playerId = playerOfReply(responseId);
        let reader: string | null = null;
        if (playerId !== undefined) {
            const alone = this.turns.get(ReplyReaders.turnKey(spaceName, playerId)) ?? now.alone(playerId);
            if (alone) reader = now.spaceUserIdOf(playerId) ?? null;
        }
        this.bound.set(responseId, { spaceName, reader });
        if (this.bound.size > MAX_BOUND) this.bound.delete(this.bound.keys().next().value as string);
        return reader ?? undefined;
    }

    /** The replies in this space that are for one reader alone. */
    forOneReaderIn(spaceName: string): string[] {
        const replies: string[] = [];
        for (const [responseId, reply] of this.bound) {
            if (reply.spaceName === spaceName && reply.reader !== null) replies.push(responseId);
        }
        return replies;
    }

    /** The person left the space: the next reply for them there is decided afresh. */
    personLeft(spaceName: string, playerId: number): void {
        this.turns.delete(ReplyReaders.turnKey(spaceName, playerId));
    }

    /** The bot left the space. */
    spaceLeft(spaceName: string): void {
        for (const key of [...this.turns.keys()]) {
            if (key.startsWith(`${spaceName}\n`)) this.turns.delete(key);
        }
        for (const [responseId, reply] of [...this.bound]) {
            if (reply.spaceName === spaceName) this.bound.delete(responseId);
        }
    }

    reset(): void {
        this.turns.clear();
        this.bound.clear();
    }
}
