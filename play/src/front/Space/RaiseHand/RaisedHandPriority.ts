import type { VideoBox } from "../Space";

/**
 * A raised hand comes right after whoever is talking (VIDEO_STARTING_PRIORITY 2000 + their rank) and before everyone
 * else (2000 + 9999 less a recent-speaker bonus, or LAST_VIDEO_BOX_PRIORITY 20000), in the order hands went up, so a
 * hand is never hidden behind "+N".
 */
export const RAISED_HAND_PRIORITY = 7000;

/**
 * The priority a video is sorted with: its own, or a raised hand's when the person's hand is up. Only the person's
 * camera, not their screen share.
 */
export function priorityWithRaisedHand(
    item: Pick<VideoBox, "uniqueId" | "priority" | "spaceUser">,
    handPositions: ReadonlyMap<string, number>
): number {
    const position = item.uniqueId === item.spaceUser.spaceUserId ? handPositions.get(item.spaceUser.uuid) : undefined;
    return position === undefined ? item.priority : Math.min(item.priority, RAISED_HAND_PRIORITY + position);
}
