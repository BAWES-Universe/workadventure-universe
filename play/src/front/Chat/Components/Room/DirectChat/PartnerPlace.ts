import { AvailabilityStatus } from "@workadventure/messages";
import type { ChatPresence, ChatUser } from "../../../Connection/ChatConnection";

/**
 * Where the other person of a direct chat is right now, as the header and profile say it:
 * - "talking": in a bubble with you
 * - "here": in Universe, on your map
 * - "elsewhere": in Universe, on another map
 * - "away" / "busy": in Universe, with that status set (on any map)
 * - "chatOnly": not in Universe, but online on chat (Element or another Matrix app)
 * - "offline": neither
 */
export type PartnerPlace =
    | { kind: "talking" }
    | { kind: "here"; roomName?: string }
    | { kind: "elsewhere"; roomName?: string }
    | { kind: "away"; status: AvailabilityStatus; roomName?: string; sameMap: boolean }
    | { kind: "busy"; status: AvailabilityStatus; roomName?: string; sameMap: boolean }
    | { kind: "chatOnly" }
    | { kind: "offline" };

export interface PartnerPlaceInput {
    /** They have an avatar in Universe right now. */
    inGame: boolean;
    sameMap: boolean;
    roomName?: string;
    availability?: AvailabilityStatus;
    talkingWithYou: boolean;
    chatPresence: ChatPresence;
}

const AWAY_STATUSES = new Set([AvailabilityStatus.AWAY, AvailabilityStatus.BACK_IN_A_MOMENT]);
const BUSY_STATUSES = new Set([AvailabilityStatus.BUSY, AvailabilityStatus.DO_NOT_DISTURB]);

export function resolvePartnerPlace(input: PartnerPlaceInput): PartnerPlace {
    if (!input.inGame) {
        return input.chatPresence === "offline" ? { kind: "offline" } : { kind: "chatOnly" };
    }
    if (input.talkingWithYou) return { kind: "talking" };
    if (input.availability !== undefined && AWAY_STATUSES.has(input.availability)) {
        return { kind: "away", status: input.availability, roomName: input.roomName, sameMap: input.sameMap };
    }
    if (input.availability !== undefined && BUSY_STATUSES.has(input.availability)) {
        return { kind: "busy", status: input.availability, roomName: input.roomName, sameMap: input.sameMap };
    }
    return input.sameMap ? { kind: "here", roomName: input.roomName } : { kind: "elsewhere", roomName: input.roomName };
}

/** In Universe right now, so their woka gets the live ring. */
export function isInUniverse(place: PartnerPlace): boolean {
    return place.kind !== "chatOnly" && place.kind !== "offline";
}

/**
 * Which ways to reach them work right now. Walk to also travels to another map; Locate only finds someone on yours.
 * While you're already talking, walking to them is pointless.
 */
export function partnerActions(place: PartnerPlace, canReach: boolean): { walkTo: boolean; locate: boolean } {
    if (!canReach) return { walkTo: false, locate: false };
    switch (place.kind) {
        case "talking":
            return { walkTo: false, locate: true };
        case "here":
            return { walkTo: true, locate: true };
        case "elsewhere":
            return { walkTo: true, locate: false };
        case "away":
        case "busy":
            return { walkTo: true, locate: place.sameMap };
        case "chatOnly":
        case "offline":
            return { walkTo: false, locate: false };
    }
}

/**
 * Of someone's avatars (one per tab or device), the one on your map if there is one, else the first one in Universe.
 * Entries without a map are chat accounts, not avatars.
 */
export function findInUniverse(
    map: ReadonlyMap<string | undefined, { roomName: string | undefined; users: readonly ChatUser[] }>,
    chatId: string,
    currentRoomUrl: string | undefined
) {
    let found: { user: ChatUser; roomName: string | undefined } | undefined;
    for (const [playUri, { roomName, users }] of map) {
        if (!playUri) continue;
        const user = users.find((candidate) => candidate.chatId === chatId);
        if (!user) continue;
        const entry = { user: { ...user, playUri: user.playUri ?? playUri }, roomName: roomName ?? user.roomName };
        if (playUri === currentRoomUrl) return entry;
        found ??= entry;
    }
    return found;
}
