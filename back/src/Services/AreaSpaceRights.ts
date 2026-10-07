import type { AreaData } from "@workadventure/map-editor";
import { areaSpaceName } from "@workadventure/shared-utils/src/Space/areaSpaceName";

interface WamLike {
    areas: Record<string, AreaData> | AreaData[];
}

/**
 * The meeting rooms and speaker zones of a room that a user may not join, as the names the front joins them with.
 *
 * An area limited to some roles ("Who can enter") only lets in the players who carry one of its read or write tags,
 * unless they may edit the room. The browser already keeps the others out; this gives the server the same rule so a
 * crafted client cannot join the area's meeting or stage anyway.
 *
 * A name is refused only when every area carrying it is closed to this user (a Stage and its Audience share a name,
 * so being let into either is enough). Names the map does not know are never refused, and neither are bots, which
 * join the room's spaces on their own account.
 */
export function refusedAreaSpaces(
    wam: WamLike | undefined,
    roomUrl: string,
    user: { tags: string[]; uuid: string; canEdit: boolean }
): string[] {
    if (wam === undefined || user.canEdit || isBot(user)) {
        return [];
    }
    const areas = Array.isArray(wam.areas) ? wam.areas : Object.values(wam.areas);
    const byId = new Map(areas.map((area) => [area.id, area]));

    const refused = new Set<string>();
    const allowed = new Set<string>();
    for (const area of areas) {
        const names = spaceNamesOf(area, byId, roomUrl);
        if (names.length === 0) continue;
        const open = canEnter(area, user.tags);
        for (const name of names) {
            (open ? allowed : refused).add(name);
        }
    }
    return [...refused].filter((name) => !allowed.has(name));
}

function isBot(user: { tags: string[]; uuid: string }): boolean {
    return user.tags.includes("bot") || user.uuid.startsWith("bot-");
}

function canEnter(area: AreaData, userTags: string[]): boolean {
    const rights = area.properties.find((property) => property.type === "restrictedRightsPropertyData");
    if (rights === undefined) {
        return true;
    }
    // Older map files may predate these fields (the wam is read raw, not through the schema defaults).
    return [...(rights.writeTags ?? []), ...(rights.readTags ?? [])].some((tag) => userTags.includes(tag));
}

/** The spaces an area's meeting room or speaker zone is joined under (see AreasPropertiesListener in the front). */
function spaceNamesOf(area: AreaData, byId: Map<string, AreaData>, roomUrl: string): string[] {
    const names: string[] = [];
    for (const property of area.properties) {
        switch (property.type) {
            case "livekitRoomProperty": {
                const roomName = property.roomName.trim().length === 0 ? property.id : property.roomName;
                names.push(areaSpaceName(roomName, roomUrl));
                break;
            }
            case "speakerMegaphone": {
                if (property.name !== undefined) {
                    names.push(areaSpaceName(property.name, roomUrl));
                }
                break;
            }
            case "listenerMegaphone": {
                // The listener names the stage by its area id
                const stage = byId.get(property.speakerZoneName);
                const stageName = stage?.properties.find((candidate) => candidate.type === "speakerMegaphone");
                if (stageName !== undefined && stageName.type === "speakerMegaphone" && stageName.name !== undefined) {
                    names.push(areaSpaceName(stageName.name, roomUrl));
                }
                break;
            }
            default:
                break;
        }
    }
    return names;
}
