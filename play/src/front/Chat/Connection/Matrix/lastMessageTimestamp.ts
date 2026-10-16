/** The parts of a Matrix event the chat list time needs. */
export interface TimelineEventLike {
    getType(): string;
    getTs(): number;
    getRelation(): { rel_type?: string } | null | undefined;
}

/**
 * Event types that are a message someone sent, as the chat shows them (it shows no stickers).
 * Encrypted ones count before they are decrypted.
 */
const MESSAGE_EVENT_TYPES = new Set(["m.room.message", "m.room.encrypted"]);
/** Edits and reactions, which stay readable on an encrypted event before it is decrypted. */
const NOT_A_NEW_MESSAGE = new Set(["m.replace", "m.annotation"]);

/**
 * When the last message in a room was sent, for the chat list's time and order.
 * Only messages count: a member event (someone's new name or picture, which Matrix adds to every room they are in),
 * a reaction, an edit or any other room change does not move the chat. With no message at all, the room's creation
 * time is used; with no time at all, `Number.MIN_SAFE_INTEGER` (what Matrix reports for "never").
 */
export function lastMessageTimestamp(
    timelineEvents: readonly TimelineEventLike[],
    newestLoadedMessageTs: number | undefined,
    roomCreatedTs: number | undefined
): number {
    let newest = 0;
    for (let index = timelineEvents.length - 1; index >= 0; index--) {
        const event = timelineEvents[index];
        if (!MESSAGE_EVENT_TYPES.has(event.getType())) continue;
        const relType = event.getRelation()?.rel_type;
        if (relType !== undefined && NOT_A_NEW_MESSAGE.has(relType)) continue;
        const ts = event.getTs();
        if (Number.isFinite(ts) && ts > 0) {
            newest = ts;
            break;
        }
    }
    if (newestLoadedMessageTs !== undefined && Number.isFinite(newestLoadedMessageTs)) {
        newest = Math.max(newest, newestLoadedMessageTs);
    }
    if (newest > 0) return newest;
    if (roomCreatedTs !== undefined && Number.isFinite(roomCreatedTs) && roomCreatedTs > 0) return roomCreatedTs;
    return Number.MIN_SAFE_INTEGER;
}
