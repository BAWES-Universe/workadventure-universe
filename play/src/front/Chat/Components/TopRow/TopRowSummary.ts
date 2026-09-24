/**
 * Pure logic behind the pinned top row of the chat list (the proximity chat, named by who you're with).
 * No stores and no translations in here: callers pass the state and the translated templates,
 * so every rule can be unit tested.
 */

export type TopRowSpaceKind = "none" | "bubble" | "meeting" | "stream";

export interface TopRowPerson {
    id: string;
    name: string;
}

export type TopRowArea<P extends TopRowPerson = TopRowPerson> =
    | {
          /** A meeting area with its chat disabled: the space was joined directly and lists who is there. */
          kind: "video";
          name: string;
          participants: P[];
      }
    | {
          /** An area with a Matrix room only: there is no space, so nothing is known about who is there. */
          kind: "matrix";
          name: string;
      };

export interface TopRowInput<P extends TopRowPerson = TopRowPerson> {
    /** What the proximity chat is connected to. */
    spaceKind: TopRowSpaceKind;
    /** The display name of the proximity chat (the area's name in a meeting or zone). */
    spaceName: string;
    /** The other people in the proximity chat's space, this tab's own avatar excluded. */
    participants: P[];
    /** Areas this tab's avatar stands in that the proximity chat is not connected to. */
    areas: TopRowArea<P>[];
}

export type TopRowState<P extends TopRowPerson = TopRowPerson> =
    /** Other people are with you. Named by the area in a meeting, by their names otherwise. */
    | { kind: "withPeople"; people: P[]; areaName: string | undefined }
    /** A meeting area whose space says nobody else is there. */
    | { kind: "meetingAlone"; areaName: string }
    /** An area where nothing is known about who is there: name it, and claim nothing. */
    | { kind: "area"; areaName: string }
    /** No bubble, no meeting. */
    | { kind: "alone" };

/**
 * Decides what the top row shows. It never claims a place is empty unless the space that
 * lists who is in that place says so.
 */
export function resolveTopRowState<P extends TopRowPerson>(input: TopRowInput<P>): TopRowState<P> {
    const { spaceKind, spaceName, participants, areas } = input;

    if (spaceKind === "meeting" || spaceKind === "stream") {
        if (participants.length > 0) {
            return { kind: "withPeople", people: participants, areaName: spaceName };
        }
        // A speaker/listener zone only lists the people streaming: listeners may be there, so claim nothing.
        return spaceKind === "meeting"
            ? { kind: "meetingAlone", areaName: spaceName }
            : { kind: "area", areaName: spaceName };
    }

    if (spaceKind === "bubble" && participants.length > 0) {
        return { kind: "withPeople", people: participants, areaName: undefined };
    }

    const videoArea = areas.find((area) => area.kind === "video");
    if (videoArea && videoArea.kind === "video") {
        if (videoArea.participants.length > 0) {
            return { kind: "withPeople", people: videoArea.participants, areaName: videoArea.name };
        }
        return { kind: "meetingAlone", areaName: videoArea.name };
    }

    const matrixArea = areas.find((area) => area.kind === "matrix");
    if (matrixArea) {
        return { kind: "area", areaName: matrixArea.name };
    }

    return { kind: "alone" };
}

export interface NameTemplates {
    /** "Sara & Omar" */
    two: (params: { first: string; second: string }) => string;
    /** "Sara, Omar +3" */
    more: (params: { first: string; second: string; count: number }) => string;
}

/**
 * "Sara", "Sara & Omar", "Sara, Omar +3". Blank names are skipped; an empty list gives "".
 */
export function formatPeopleNames(names: readonly string[], templates: NameTemplates): string {
    const cleanNames = names.map((name) => name.trim()).filter((name) => name !== "");
    if (cleanNames.length === 0) return "";
    if (cleanNames.length === 1) return cleanNames[0];
    if (cleanNames.length === 2) return templates.two({ first: cleanNames[0], second: cleanNames[1] });
    return templates.more({ first: cleanNames[0], second: cleanNames[1], count: cleanNames.length - 2 });
}

export interface TypingTemplates {
    /** "Sara is typing" */
    one: (params: { name: string }) => string;
    /** "Sara & Omar are typing" */
    two: (params: { first: string; second: string }) => string;
    /** "3 people are typing" */
    many: (params: { count: number }) => string;
    /** Used for a typing member without a name. */
    someone: string;
}

/**
 * "Sara is typing", "Sara & Omar are typing", "3 people are typing". The animated ellipsis is added by the view.
 * Returns undefined when nobody is typing.
 */
export function formatTypingLine(
    typingNames: readonly (string | null | undefined)[],
    templates: TypingTemplates
): string | undefined {
    if (typingNames.length === 0) return undefined;
    const names = typingNames.map((name) => (name && name.trim() !== "" ? name.trim() : templates.someone));
    if (names.length === 1) return templates.one({ name: names[0] });
    if (names.length === 2) return templates.two({ first: names[0], second: names[1] });
    return templates.many({ count: names.length });
}

/**
 * The name the top row shows for a meeting area: the area's name, else the meeting's room name, else the fallback.
 */
export function resolveMeetingAreaName(
    areaName: string | undefined,
    roomName: string | undefined,
    fallback: string
): string {
    const trimmedAreaName = areaName?.trim();
    if (trimmedAreaName) return trimmedAreaName;
    const trimmedRoomName = roomName?.trim();
    if (trimmedRoomName) return trimmedRoomName;
    return fallback;
}

export interface WorldUser {
    spaceUserId: string;
    playUri: string | undefined;
}

export interface WorldPresence {
    /** Avatars on this map, this tab's own avatar excluded. */
    here: number;
    /** Avatars on other maps of this world. */
    elsewhere: number;
}

function normalizePlayUri(playUri: string): string {
    try {
        const url = new URL(playUri, "https://placeholder.invalid");
        url.search = "";
        url.hash = "";
        return url.toString();
    } catch {
        return playUri;
    }
}

/**
 * Counts who is in the world, split by map. Every avatar counts, including other tabs (clones) of
 * the same account; only this tab's own avatar is excluded.
 */
export function countWorldPresence(
    users: Iterable<WorldUser>,
    mySpaceUserId: string | undefined,
    currentRoomUrl: string
): WorldPresence {
    const currentRoom = normalizePlayUri(currentRoomUrl);
    let here = 0;
    let elsewhere = 0;
    for (const user of users) {
        if (mySpaceUserId !== undefined && user.spaceUserId === mySpaceUserId) continue;
        if (user.playUri && normalizePlayUri(user.playUri) === currentRoom) {
            here++;
        } else {
            elsewhere++;
        }
    }
    return { here, elsewhere };
}

export interface WorldLineTemplates {
    /** "3 others in Headquarters" */
    othersInRoom: (params: { count: number; roomName: string }) => string;
    /** "3 others on this map", when the map has no name */
    othersOnThisMap: (params: { count: number }) => string;
    /** "12 elsewhere in this world" */
    elsewhere: (params: { count: number }) => string;
    /** "No one else is in this world right now" */
    nobodyInWorld: string;
    /** Joins the two parts: " · " */
    separator: string;
}

/**
 * The second line of the alone state: "3 others in Headquarters · 12 elsewhere in this world".
 */
export function formatWorldLine(
    presence: WorldPresence,
    roomName: string | undefined,
    templates: WorldLineTemplates
): string {
    if (presence.here === 0 && presence.elsewhere === 0) return templates.nobodyInWorld;
    const trimmedRoomName = roomName?.trim();
    const herePart = trimmedRoomName
        ? templates.othersInRoom({ count: presence.here, roomName: trimmedRoomName })
        : templates.othersOnThisMap({ count: presence.here });
    if (presence.elsewhere === 0) return herePart;
    return herePart + templates.separator + templates.elsewhere({ count: presence.elsewhere });
}
