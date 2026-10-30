import { MathUtils } from "@workadventure/math-utils";
import type { AreaData, MaxUsersInAreaPropertyData } from "./types";
import { isAreaPropertyActive } from "./Utils";

/**
 * The name under which the server shares, with everyone in the room, how many people are inside an area that has a
 * "Max people" setting (see AreaOccupancy in the back). The value is the count, as a string.
 */
export const AREA_USERS_INSIDE_KEY = "usersInside";

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
