import { createHash } from "crypto";
import { FilterType } from "@workadventure/messages";
import { AREA_SPACE_PREFIX, isAreaSpaceName } from "@workadventure/shared-utils/src/Space/areaSpaceName";
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
 * Map script spaces are unchanged. Members-only areas inside a room are still only enforced by the browser.
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
    return localSpaceName.includes("#");
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
    socketData: Pick<SocketData, "grantedBubbleSpaces" | "megaphoneChannels">
): void {
    const { localSpaceName, filterType, propertiesToSync } = request;

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
