import type { TranslationFunctions } from "../../../i18n/i18n-types";
import type { BroadcastReach, BroadcastReachInfo } from "../../Stores/BroadcastStore";

export const REACH_ORDER: BroadcastReach[] = ["ROOM", "WORLD", "UNIVERSE"];

export function isBroadcastReach(scope: string): scope is BroadcastReach {
    return scope === "ROOM" || scope === "WORLD" || scope === "UNIVERSE";
}

/** "This room", "This world", "Everywhere in this universe". */
export function reachTitle(LL: TranslationFunctions, reach: BroadcastReach): string {
    switch (reach) {
        case "ROOM":
            return LL.broadcast.reach.room();
        case "WORLD":
            return LL.broadcast.reach.world();
        case "UNIVERSE":
            return LL.broadcast.reach.universe();
    }
}

/** The name of what the reach covers (the room's, the world's or the universe's), or "" when it is not known. */
export function reachName(reach: BroadcastReach, info: BroadcastReachInfo): string {
    switch (reach) {
        case "ROOM":
            return info.roomName;
        case "WORLD":
            return info.worldName ?? "";
        case "UNIVERSE":
            return info.universeName ?? "";
    }
}

/** The line under a reach: "Main Hall · 18 people here now", "BAWES HQ · 25 people now · 4 rooms",
 * "BAWES · 60 people now · 9 worlds". */
export function reachDetail(LL: TranslationFunctions, reach: BroadcastReach, info: BroadcastReachInfo): string {
    const name = reachName(reach, info);
    const people = (count: number | undefined) =>
        count !== undefined ? LL.broadcast.reach.peopleNow({ count }) : undefined;
    let counts: (string | undefined)[];
    switch (reach) {
        case "ROOM":
            counts = [LL.broadcast.reach.peopleHere({ count: info.peopleHere })];
            break;
        case "WORLD":
            counts = [
                people(info.worldPeople),
                info.worldRooms > 0 ? LL.broadcast.reach.rooms({ count: info.worldRooms }) : undefined,
            ];
            break;
        case "UNIVERSE":
            counts = [
                people(info.universePeople),
                info.universeWorlds > 0 ? LL.broadcast.reach.worlds({ count: info.universeWorlds }) : undefined,
            ];
            break;
    }
    return [name, ...counts].filter((part) => part).join(" · ");
}

/** The header's line once a reach is chosen: "To This world · BAWES HQ, 4 rooms". */
export function reachSummary(LL: TranslationFunctions, reach: BroadcastReach, info: BroadcastReachInfo): string {
    const detail = reachDetail(LL, reach, info).replace(" · ", ", ");
    const title = reachTitle(LL, reach);
    return LL.broadcast.reach.to({ reach: detail ? `${title} · ${detail}` : title });
}
