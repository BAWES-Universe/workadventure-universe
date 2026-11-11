/**
 * Where a thing a bot remembers was said, and who else was there (game #1993).
 *
 * A bot is one bot everywhere: it remembers a person from their direct messages and from the map alike. What changes
 * with other people around is who may read an answer. So each thing it remembers (a line of the conversation, a fact
 * about the person) carries where it was said. Private is decided by that, never by how sensitive it sounds:
 *
 * - said in a direct message, or on the map with nobody else in the bubble or meeting room: private;
 * - said while other people were there: those people heard it, so it can be said in front of them again;
 * - nothing kept about where it was said (everything from before this was kept): private.
 *
 * The server decides with this, not a model: a reply other people read is built without the private things, so there is
 * nothing in it to keep secret.
 */
export interface Heard {
    /**
     * A direct message, or the nearby chat of a bubble or meeting room. 'open' is for a note of the bot's own that says
     * nothing anyone said ("first conversation with this person"): any reply may use it.
     */
    place: 'dm' | 'nearby' | 'open';
    /** Everyone else who was there, by who they are (people, guests and other bots alike). Empty: nobody but the bot. */
    with: string[];
}

/**
 * What a reply may be built from: everything the bot and the person share, or only what everyone who is here now was
 * there for. `present` is everyone else in the bubble or meeting room, never the person themselves.
 */
export type MemoryView = 'all' | { present: readonly string[] };

/**
 * Stands for someone the bot cannot name (it has no id for them, or cannot tell who is around): nobody was ever "there
 * with" this, so nothing private is open to a view that holds it.
 */
export const SOMEONE_UNKNOWN = '?';

/** A direct message: nobody else is ever there. */
export function heardInDm(): Heard {
    return { place: 'dm', with: [] };
}

/** A note of the bot's own that repeats nothing anyone said. */
export function nothingSaid(): Heard {
    return { place: 'open', with: [] };
}

/** Whether a reply built for this view may use a thing heard this way. */
export function mayUse(heard: Heard | undefined, view: MemoryView): boolean {
    if (view === 'all' || heard?.place === 'open') return true;
    // Never kept, or kept in a shape this code does not know: private
    if (!heard || heard.place !== 'nearby' || !Array.isArray(heard.with) || heard.with.length === 0) return false;
    // With nobody named there is nobody to check: the caller meant "all", and saying so is its job
    if (view.present.length === 0) return false;
    return view.present.every((id) => id !== SOMEONE_UNKNOWN && heard.with.includes(id));
}

/**
 * The same thing heard again: everyone who was there either time has heard it. A thing never stamped stays unstamped only
 * until it is heard once with a stamp.
 */
export function heardAlso(before: Heard | undefined, now: Heard | undefined): Heard | undefined {
    if (!now) return before;
    if (!before) return { place: now.place, with: [...now.with] };
    if (before.place === 'open' || now.place === 'open') return nothingSaid();
    const everyone = [...new Set([...before.with, ...now.with])];
    return { place: everyone.length > 0 ? 'nearby' : now.place, with: everyone };
}

/** A copy that shares nothing with the original. */
export function copyHeard(heard: Heard | undefined): Heard | undefined {
    return heard ? { place: heard.place, with: [...(Array.isArray(heard.with) ? heard.with : [])] } : undefined;
}
