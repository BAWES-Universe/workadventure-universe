import { FilterType } from "@workadventure/messages";
import type { SocketData } from "../models/Websocket/SocketData";
import { isMegaphoneChannelSpace } from "../models/MegaphoneRights";

/**
 * Which spaces a player may join, and how.
 *
 * Spaces carry audio, video, chat and the list of the people in them, so a client must not be able to join any space
 * by name. Phase 1 covers the spaces whose rightful members the pusher already knows:
 * - proximity bubbles (names containing "#", made by the back's Group): only the members the back asked to join;
 * - the world space ("allWorldUser"): everyone in the world, as a plain user list without audio or video;
 * - broadcast channel spaces (room, world, universe): everyone, but only as live streaming spaces (going live is
 *   checked in Space).
 * Every other space (meeting areas, speaker zones, map script spaces) is unchanged.
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
