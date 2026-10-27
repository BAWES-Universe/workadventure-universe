import type { RoomDescription } from "@workadventure/messages";
import { isBot } from "./AreaSpaceRights";

/**
 * Who is in a room, for the admin's room list (the Discord report, #1389): everyone (nbUsers, as before), how many of
 * them are bots, and the people's names, one per account (several tabs of one person are one name), A to Z.
 */
export function describeRoom(
    roomId: string,
    users: Iterable<{ uuid: string; name: string; tags: string[] }>
): RoomDescription {
    let nbUsers = 0;
    let nbBots = 0;
    const names = new Map<string, string>();
    for (const user of users) {
        nbUsers++;
        if (isBot(user)) {
            nbBots++;
        } else if (!names.has(user.uuid)) {
            names.set(user.uuid, user.name);
        }
    }
    const peopleNames = [...names.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    return { roomId, nbUsers, nbBots, peopleNames };
}
