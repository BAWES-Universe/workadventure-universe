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
/**
 * Replies that are still being written are never let go of for room. Only so many of them are kept: past that, a new reply is held
 * back (never decided without its reader), unless the oldest unfinished one is so old it can only have been dropped by whoever wrote it.
 */
const MAX_BOUND_ALL = 3000;
const ABANDONED_AFTER_MS = 24 * 60 * 60_000;
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
    private readonly bound = new Map<string, { spaceName: string; reader: string | null; done?: true; at: number }>();
    /** By reply: its space, for a reply decided to be for one person alone whose reader cannot be named yet (it stays private until it can be). */
    private readonly unresolved = new Map<string, string>();
    /** By space and player: whether the reply last sent to them there went to them alone. */
    private readonly latest = new Map<string, boolean>();

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
     *
     * Null when the reply is for one person who cannot be named yet: it is NOT for everyone, so nothing of it is sent, and
     * nothing is kept, so the next piece asks again.
     */
    readerOf(spaceName: string, responseId: string, now: { alone(playerId: number): boolean; spaceUserIdOf(playerId: number): string | undefined }): string | undefined | null {
        const playerId = playerOfReply(responseId);
        const known = this.bound.get(responseId);
        if (known) {
            this.noteLatest(spaceName, playerId, known.reader !== null);
            return known.reader ?? undefined;
        }
        let reader: string | null = null;
        if (playerId !== undefined) {
            // A reply already decided to be private stays so, whatever a newer turn for the same person says meanwhile
            const alone = this.unresolved.has(responseId) || (this.turns.get(ReplyReaders.turnKey(spaceName, playerId)) ?? now.alone(playerId));
            if (alone) {
                const named = now.spaceUserIdOf(playerId);
                // Alone with the bot, but their id in the space is not known yet: unresolved is not public, and the decision is kept for the next piece
                if (!named) {
                    this.unresolved.set(responseId, spaceName);
                    if (this.unresolved.size > MAX_BOUND) this.unresolved.delete(this.unresolved.keys().next().value as string);
                    return null;
                }
                reader = named;
            }
        }
        // No room for another reply that is still being written: held back, not decided without keeping its reader (nothing is kept, so the
        // next piece asks again). Reached only by thousands of replies that all never ended.
        if (!this.makeRoom(true)) return null;
        this.unresolved.delete(responseId);
        this.bound.set(responseId, { spaceName, reader, at: Date.now() });
        this.noteLatest(spaceName, playerId, reader !== null);
        return reader ?? undefined;
    }

    /**
     * Past the cap, the oldest reply that is complete is let go of. A reply still being written keeps its reader: a late piece of
     * it would otherwise be decided afresh and could go to someone who has walked up since. So when only unfinished replies are left
     * and they fill MAX_BOUND_ALL, none is let go of to make room, unless it is so old it was abandoned; `forNew` then says there is
     * no room for one more (false), and the new reply is held back.
     */
    private makeRoom(forNew = false): boolean {
        const limit = forNew ? MAX_BOUND - 1 : MAX_BOUND;
        while (this.bound.size > limit) {
            const finished = [...this.bound].find(([, reply]) => reply.done);
            if (finished) {
                this.bound.delete(finished[0]);
                continue;
            }
            if (this.bound.size < (forNew ? MAX_BOUND_ALL : MAX_BOUND_ALL + 1)) return true;
            const [oldestId, oldest] = this.bound.entries().next().value as [string, { at: number }];
            if (Date.now() - oldest.at < ABANDONED_AFTER_MS) return !forNew;
            this.bound.delete(oldestId);
        }
        return true;
    }

    /**
     * The reader of a reply that is already bound, for a line ABOUT that reply (a speaking or stopped mark, a note that it was kept quiet):
     * the reader's space user id, undefined when it is for everyone, null when the reply is not known. Such a line never decides who
     * a reply is for: a reply let go of, or one that never started here, gets nothing, so a late mark cannot go to someone the reply
     * was never for.
     */
    knownReaderOf(responseId: string): string | undefined | null {
        const known = this.bound.get(responseId);
        if (!known) return null;
        return known.reader ?? undefined;
    }

    /** The reply's last piece went out: its reader is kept for the marks that follow it, and can be let go of once the cap needs room. */
    complete(responseId: string): void {
        const reply = this.bound.get(responseId);
        if (!reply) return;
        reply.done = true;
        this.makeRoom();
    }

    private noteLatest(spaceName: string, playerId: number | undefined, alone: boolean): void {
        if (playerId === undefined) return;
        const key = ReplyReaders.turnKey(spaceName, playerId);
        this.latest.delete(key);
        this.latest.set(key, alone);
        if (this.latest.size > MAX_TURNS) this.latest.delete(this.latest.keys().next().value as string);
    }

    /**
     * Whether the reply last sent to this person here went to them alone. What the bot said in it is then remembered as
     * said with nobody else there, whoever has walked up since: nobody else was sent it.
     */
    wentToThemAlone(spaceName: string, playerId: number): boolean {
        return this.latest.get(ReplyReaders.turnKey(spaceName, playerId)) === true;
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
        this.latest.delete(ReplyReaders.turnKey(spaceName, playerId));
    }

    /** The bot left the space. */
    spaceLeft(spaceName: string): void {
        for (const kept of [this.turns, this.latest]) {
            for (const key of [...kept.keys()]) {
                if (key.startsWith(`${spaceName}\n`)) kept.delete(key);
            }
        }
        for (const [responseId, reply] of [...this.bound]) {
            if (reply.spaceName === spaceName) this.bound.delete(responseId);
        }
        for (const [responseId, space] of [...this.unresolved]) {
            if (space === spaceName) this.unresolved.delete(responseId);
        }
    }

    reset(): void {
        this.turns.clear();
        this.bound.clear();
        this.unresolved.clear();
        this.latest.clear();
    }
}
