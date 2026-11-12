import { createHash } from "crypto";
import { FilterType } from "@workadventure/messages";
import { AREA_SPACE_PREFIX, isAreaSpaceName } from "@workadventure/shared-utils/src/Space/areaSpaceName";
import {
    BOT_IDENTIFIER_PREFIX,
    isCallSpaceName,
    parseCallSpaceName,
} from "@workadventure/shared-utils/src/Space/callSpaceName";
import type { SocketData } from "../models/Websocket/SocketData";
import { isMegaphoneChannelSpace } from "../models/MegaphoneRights";
import { toGlobalSpaceName } from "./SpaceNames";

/**
 * Which spaces a player may join, and how.
 *
 * Spaces carry audio, video, chat and the list of the people in them, so a client must not be able to join any space
 * by name. Phase 1 covers the spaces whose rightful members the pusher already knows:
 * - proximity bubbles (names containing "#", made by the back's Group): only the members the back asked to join;
 * - the world space ("allWorldUser"): everyone in the world, as a plain user list without audio or video;
 * - broadcast channel spaces (room, world, universe): everyone, but only as live streaming spaces (going live is
 *   checked in Space);
 * - meeting rooms and speaker zones (names starting with AREA_SPACE_PREFIX): only from the room they are in, because
 *   toServerSpaceName puts the player's own room in their server name.
 * - meeting rooms and speaker zones of an area limited to roles ("Who can enter"): only the players with one of those
 *   roles, as the back works out for each player (refusedAreaSpaces). ENFORCE_AREA_SPACE_RIGHTS=false turns this off
 *   (the pusher then keeps the list empty, see SocketManager).
 * - call spaces (names starting with CALL_SPACE_PREFIX, game #2004): only the person who called and the bot they called,
 *   as the name says, and never a third (see checkCallSpaceJoin).
 * Map script spaces are unchanged.
 */

export const WORLD_SPACE_NAME = "allWorldUser";

/** The only properties the world space syncs. Asking for camera or microphone would turn it into a call. */
export const WORLD_SPACE_PROPERTIES: ReadonlySet<string> = new Set(["availabilityStatus", "chatID"]);

export class SpaceJoinRefusedError extends Error {
    constructor(localSpaceName: string, reason: string) {
        super(`Cannot join space "${localSpaceName}": ${reason}`);
        this.name = "SpaceJoinRefusedError";
    }
}

/** The name a space has on the servers, from the name the front gives it. */
export function toWorldSpaceName(world: string, localSpaceName: string): string {
    return `${world}.${localSpaceName}`;
}

/**
 * The name a space has on the servers, from the name the front gives it and the player's own socket.
 * Meeting rooms and speaker zones also get the player's room (as a SHA-256 of its URL), so whatever name a browser
 * sends, it can only reach the meeting rooms and speaker zones of the room it is in. The room part has a fixed
 * length and no other space starts with AREA_SPACE_PREFIX, so two different rooms or areas never share a name.
 * Every other space is named as toGlobalSpaceName says, so the universe broadcast channel reaches every world.
 */
export function toServerSpaceName(socketData: Pick<SocketData, "world" | "roomId">, localSpaceName: string): string {
    if (isAreaSpaceName(localSpaceName)) {
        const roomKey = createHash("sha256").update(socketData.roomId).digest("hex");
        return toWorldSpaceName(socketData.world, `${AREA_SPACE_PREFIX}${roomKey}.${localSpaceName}`);
    }
    return toGlobalSpaceName(socketData, localSpaceName);
}

/** Bubble spaces are named `${roomId}#${groupId}#${time}` by the back. No other space the front makes has a "#". */
export function isBubbleSpaceName(localSpaceName: string): boolean {
    return !isCallSpaceName(localSpaceName) && localSpaceName.includes("#");
}

/** How many sockets a call space ever holds: the person and the bot. */
export const CALL_SPACE_MEMBERS = 2;

/**
 * A call space is for the person who called and the bot they called, as its name says. The name is only trusted when
 * it is exactly the one callSpaceName makes, and each side is who its own sign-in says it is: the person by their uuid,
 * the bot by the identifier its token carries ("bot-" and its id). Nobody else gets in, whatever name they ask for.
 */
export function checkCallSpaceJoin(
    request: SpaceJoinRequest,
    socketData: Partial<Pick<SocketData, "userUuid" | "userIdentifier" | "tags">>
): void {
    const { localSpaceName, filterType } = request;
    const call = parseCallSpaceName(localSpaceName);
    if (!call) {
        throw new SpaceJoinRefusedError(localSpaceName, "this is not a call");
    }
    if (filterType !== FilterType.ALL_USERS) {
        throw new SpaceJoinRefusedError(localSpaceName, "a call lists all its users");
    }
    const isBot = socketData.tags?.includes("bot") === true;
    if (isBot) {
        if (socketData.userIdentifier !== `${BOT_IDENTIFIER_PREFIX}${call.botId}`) {
            throw new SpaceJoinRefusedError(localSpaceName, "this call is with another bot");
        }
        return;
    }
    if (!socketData.userUuid || socketData.userUuid !== call.callerUuid) {
        throw new SpaceJoinRefusedError(localSpaceName, "this call is for someone else");
    }
}

/** A call space already holding its two members takes no more. */
export function checkCallSpaceRoom(localSpaceName: string, membersNow: number): void {
    if (isCallSpaceName(localSpaceName) && membersNow >= CALL_SPACE_MEMBERS) {
        throw new SpaceJoinRefusedError(localSpaceName, "this call already has its two members");
    }
}

export interface SpaceJoinRequest {
    localSpaceName: string;
    filterType: FilterType;
    propertiesToSync: readonly string[];
}

/**
 * Throws a SpaceJoinRefusedError when this player may not join this space this way.
 */
export function checkSpaceJoin(
    request: SpaceJoinRequest,
    socketData: Pick<
        SocketData,
        "grantedBubbleSpaces" | "megaphoneChannels" | "refusedAreaSpaces" | "areaSpacePolicyUnknown"
    > &
        Partial<Pick<SocketData, "userUuid" | "userIdentifier" | "tags">>
): void {
    const { localSpaceName, filterType, propertiesToSync } = request;

    // The back has never been able to read the room's areas, so nothing says who may join this one yet
    if (socketData.areaSpacePolicyUnknown && isAreaSpaceName(localSpaceName)) {
        throw new SpaceJoinRefusedError(localSpaceName, "the room's areas could not be checked yet, try again shortly");
    }

    if (socketData.refusedAreaSpaces?.has(localSpaceName)) {
        throw new SpaceJoinRefusedError(localSpaceName, "this area is limited to other roles");
    }

    if (isCallSpaceName(localSpaceName)) {
        checkCallSpaceJoin(request, socketData);
        return;
    }

    if (isBubbleSpaceName(localSpaceName)) {
        if (!socketData.grantedBubbleSpaces.has(localSpaceName)) {
            throw new SpaceJoinRefusedError(localSpaceName, "you are not in this bubble");
        }
        if (filterType !== FilterType.ALL_USERS) {
            throw new SpaceJoinRefusedError(localSpaceName, "a bubble lists all its users");
        }
        return;
    }

    if (localSpaceName === WORLD_SPACE_NAME) {
        if (filterType !== FilterType.ALL_USERS) {
            throw new SpaceJoinRefusedError(localSpaceName, "the world space lists all its users");
        }
        const otherProperty = propertiesToSync.find((property) => !WORLD_SPACE_PROPERTIES.has(property));
        if (otherProperty !== undefined) {
            throw new SpaceJoinRefusedError(localSpaceName, `the world space does not sync "${otherProperty}"`);
        }
        return;
    }

    if (isMegaphoneChannelSpace(localSpaceName, socketData) && filterType !== FilterType.LIVE_STREAMING_USERS) {
        throw new SpaceJoinRefusedError(localSpaceName, "a broadcast channel is a live streaming space");
    }
}
