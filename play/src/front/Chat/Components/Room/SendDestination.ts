/**
 * Makes sure a message goes where it was written.
 *
 * The proximity chat keeps one id ("proximity") while the people in it change, and a file upload takes
 * time. So a send captures its room and, for the proximity chat, the space generation at submit time.
 * If that space is gone by the time the upload finishes, the message must not be sent at all.
 */

/** A room whose destination changes over time (the proximity chat): each joined or left space is a new generation. */
export interface SpaceGenerationSource {
    readonly spaceGeneration: number;
}

export interface SendDestination<R> {
    readonly room: R;
    /** The space generation at submit time, for rooms that have one. */
    readonly spaceGeneration: number | undefined;
}

export function hasSpaceGeneration(room: unknown): room is SpaceGenerationSource {
    return (
        typeof room === "object" &&
        room !== null &&
        typeof (room as Partial<SpaceGenerationSource>).spaceGeneration === "number"
    );
}

export function spaceGenerationOf(room: unknown): number | undefined {
    return hasSpaceGeneration(room) ? room.spaceGeneration : undefined;
}

/** Captures where a message is meant to go, at submit time. */
export function captureSendDestination<R>(room: R): SendDestination<R> {
    return { room, spaceGeneration: spaceGenerationOf(room) };
}

/**
 * True when the message can still go to its destination: the room has no space generation (a saved
 * conversation), or it is still in the same space as when the message was submitted.
 */
export function isSendDestinationOpen<R>(destination: SendDestination<R>): boolean {
    if (destination.spaceGeneration === undefined) return true;
    return spaceGenerationOf(destination.room) === destination.spaceGeneration;
}
