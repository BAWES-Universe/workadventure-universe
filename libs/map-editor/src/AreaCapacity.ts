import { MathUtils } from "@workadventure/math-utils";
import type { AreaData, LockableAreaPropertyData, MaxUsersInAreaPropertyData } from "./types";
import { isAreaPropertyActive } from "./Utils";

/**
 * The name under which the server shares, with everyone in the room, how many people are inside an area that has a
 * "Max people" setting (see AreaOccupancy in the back). The value is the count, as a string.
 */
export const AREA_USERS_INSIDE_KEY = "usersInside";

/**
 * The name under which the server shares whether a lockable room is locked (#1622), the same as upstream
 * WorkAdventure. The value is "true" or "false".
 */
export const AREA_LOCK_KEY = "lock";

/**
 * How far below a player's position their feet are, in game pixels. A player is inside an area when their feet are,
 * the same rule the game uses to trigger an area's settings (GameMapAreas.isPlayerInsideArea).
 */
const FEET_OFFSET_Y = 16;

export type ActiveMaxUsersProperty = MaxUsersInAreaPropertyData & { maxUsers: number };

/**
 * The area's "Max people" setting when it is switched on and sets a limit, or undefined. A limit under 1 (0 can come
 * from a map made with upstream WorkAdventure, where it means "always closed") is read as no limit: "Who can enter"
 * is how a room is closed here.
 */
export function getActiveMaxUsersProperty(area: Pick<AreaData, "properties">): ActiveMaxUsersProperty | undefined {
    for (const property of area.properties) {
        if (
            property.type === "maxUsersInAreaPropertyData" &&
            isAreaPropertyActive(property) &&
            typeof property.maxUsers === "number" &&
            property.maxUsers >= 1
        ) {
            return { ...property, maxUsers: Math.floor(property.maxUsers) };
        }
    }
    return undefined;
}

/** Whether a player standing at this position is inside the area. */
export function isPlayerPositionInArea(
    position: { x: number; y: number },
    area: Pick<AreaData, "x" | "y" | "width" | "height">
): boolean {
    return MathUtils.isOverlappingWithRectangle({ x: position.x, y: position.y + FEET_OFFSET_Y }, area);
}

/** The area's "Lockable room" setting when it is switched on, or undefined. */
export function getActiveLockableProperty(area: Pick<AreaData, "properties">): LockableAreaPropertyData | undefined {
    for (const property of area.properties) {
        if (property.type === "lockableAreaPropertyData" && isAreaPropertyActive(property)) {
            return property;
        }
    }
    return undefined;
}

/**
 * Whether someone with these tags may lock the room from inside: one of its tags, or anyone when it names none.
 * Signing in, being inside and the Owner and Admins are checked by the caller.
 */
export function canTagsLockArea(property: Pick<LockableAreaPropertyData, "allowedTags">, tags: string[]): boolean {
    const allowedTags = (property.allowedTags ?? []).filter((tag) => tag.trim() !== "");
    return allowedTags.length === 0 || allowedTags.some((tag) => tags.includes(tag));
}
