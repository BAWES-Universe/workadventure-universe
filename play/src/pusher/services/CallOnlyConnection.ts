import { randomUUID } from "crypto";
import type { ClientToServerMessage } from "@workadventure/messages";

/**
 * A call-only connection (game #2004) is a bot's connection that never joins the room: it has no body on the map, no
 * position, and it is in no list of people and in no count, because the room never heard of it. It only joins the
 * private call space of the call it was opened for (see checkCallSpaceJoin), so nothing else it sends can matter, and
 * the pusher drops anything that is not about a space.
 */

/** What a call-only connection may send: joining and leaving its space, its space user and the space's events. */
const CALL_ONLY_MESSAGES: ReadonlySet<string> = new Set([
    "addSpaceFilterMessage",
    "removeSpaceFilterMessage",
    "updateSpaceUserMessage",
    "abortQueryMessage",
    "publicEvent",
    "privateEvent",
]);

/** The only questions a call-only connection may ask: joining and leaving a space. */
const CALL_ONLY_QUERIES: ReadonlySet<string> = new Set(["joinSpaceQuery", "leaveSpaceQuery"]);

export function isAllowedForCallOnly(message: ClientToServerMessage["message"]): boolean {
    if (!message) return false;
    if (message.$case === "queryMessage") {
        return message.queryMessage.query !== undefined && CALL_ONLY_QUERIES.has(message.queryMessage.query.$case);
    }
    return CALL_ONLY_MESSAGES.has(message.$case);
}

/** The id a call-only connection has in its space: it has no room, so no room user number to build one from. */
export function callOnlySpaceUserId(): string {
    return `call_${randomUUID()}`;
}

/** Only a bot may ask for a call-only connection: its sign-in token says it is a bot, signed with our secret. */
export function mayOpenCallOnly(tokenTags: readonly string[] | undefined): boolean {
    return tokenTags?.includes("bot") === true;
}
