/**
 * Several files sent together in a direct, group or area chat stay ordinary Matrix messages, one per file, so every
 * app (and the server's tools) sees each of them. Each carries this small tag, which lets our app draw them as the
 * one gallery nearby chat already shows. Apps that do not know the tag show plain messages.
 */
export const MEDIA_GROUP_FIELD = "net.bawes.universe.media_group";

export interface MediaGroupTag {
    /** The same on every message of the group. */
    id: string;
    /** Its place in the group, from 0 (the first, which carries the words). */
    index: number;
    /** How many messages the group has. */
    count: number;
}

/** The tag of a message, or undefined when it has none or it is not usable. A group is at least two files. */
export function readMediaGroup(content: unknown): MediaGroupTag | undefined {
    if (typeof content !== "object" || content === null) return undefined;
    const raw: unknown = (content as Record<string, unknown>)[MEDIA_GROUP_FIELD];
    if (typeof raw !== "object" || raw === null) return undefined;
    const { id, index, count } = raw as Record<string, unknown>;
    if (typeof id !== "string" || id === "") return undefined;
    if (typeof index !== "number" || typeof count !== "number") return undefined;
    if (!Number.isInteger(index) || !Number.isInteger(count)) return undefined;
    if (count < 2 || index < 0 || index >= count) return undefined;
    return { id, index, count };
}
