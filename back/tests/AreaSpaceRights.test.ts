import { describe, expect, it } from "vitest";
import type { AreaData } from "@workadventure/map-editor";
import { areaSpaceName } from "@workadventure/shared-utils/src/Space/areaSpaceName";
import { refusedAreaSpaces } from "../src/Services/AreaSpaceRights";

const ROOM = "http://play.example.com/@/acme/office/lobby";

type Property = AreaData["properties"][number];

function area(id: string, properties: Property[]): AreaData {
    return { id, name: id, x: 0, y: 0, width: 32, height: 32, visible: true, properties } as AreaData;
}

const onlyStaff: Property = {
    id: "r",
    type: "restrictedRightsPropertyData",
    readTags: ["staff"],
    writeTags: [],
} as Property;
const meeting = (name: string): Property =>
    ({
        id: `lk-${name}`,
        type: "livekitRoomProperty",
        roomName: name,
        livekitRoomConfig: { startWithAudioMuted: false, startWithVideoMuted: false },
    } as Property);
const stage = (name: string): Property =>
    ({ id: `sp-${name}`, type: "speakerMegaphone", name, chatEnabled: false } as Property);
const audienceOf = (stageAreaId: string): Property =>
    ({
        id: `li-${stageAreaId}`,
        type: "listenerMegaphone",
        speakerZoneName: stageAreaId,
        chatEnabled: false,
    } as Property);

const player = { tags: [] as string[], uuid: "user-1", canEdit: false };
const wam = (...areas: AreaData[]) => ({ areas: Object.fromEntries(areas.map((a) => [a.id, a])) });
const room = (name: string) => areaSpaceName(name, ROOM);

describe("refusedAreaSpaces", () => {
    it("refuses the meeting room of an area limited to a role the player does not have", () => {
        const refused = refusedAreaSpaces(wam(area("a1", [meeting("Board"), onlyStaff])), ROOM, player);
        expect(refused).toEqual([room("Board")]);
    });

    it("lets in a player who has the role", () => {
        const refused = refusedAreaSpaces(wam(area("a1", [meeting("Board"), onlyStaff])), ROOM, {
            ...player,
            tags: ["staff"],
        });
        expect(refused).toEqual([]);
    });

    it("lets in a player with the role as a write tag, too", () => {
        const writeOnly = {
            id: "r",
            type: "restrictedRightsPropertyData",
            readTags: [],
            writeTags: ["staff"],
        } as Property;
        expect(
            refusedAreaSpaces(wam(area("a1", [meeting("Board"), writeOnly])), ROOM, { ...player, tags: ["staff"] })
        ).toEqual([]);
    });

    it("never refuses an open area", () => {
        expect(refusedAreaSpaces(wam(area("a1", [meeting("Cafe")])), ROOM, player)).toEqual([]);
    });

    it("never refuses a player who may edit the room, or a bot", () => {
        const map = wam(area("a1", [meeting("Board"), onlyStaff]));
        expect(refusedAreaSpaces(map, ROOM, { ...player, canEdit: true })).toEqual([]);
        expect(refusedAreaSpaces(map, ROOM, { ...player, tags: ["bot"] })).toEqual([]);
        expect(refusedAreaSpaces(map, ROOM, { ...player, uuid: "bot-12" })).toEqual([]);
    });

    it("refuses a closed stage, and the audience that names it, when no other area carries the name", () => {
        const map = wam(
            area("stage1", [stage("Keynote"), onlyStaff]),
            area("crowd", [audienceOf("stage1"), onlyStaff])
        );
        expect(refusedAreaSpaces(map, ROOM, player)).toEqual([room("Keynote")]);
    });

    it("lets a player into a stage's space through an open audience area", () => {
        const map = wam(area("stage1", [stage("Keynote"), onlyStaff]), area("crowd", [audienceOf("stage1")]));
        expect(refusedAreaSpaces(map, ROOM, player)).toEqual([]);
    });

    it("refuses nothing when the map has no areas or cannot be read", () => {
        expect(refusedAreaSpaces(wam(), ROOM, player)).toEqual([]);
        expect(refusedAreaSpaces(undefined, ROOM, player)).toEqual([]);
    });

    it("reads the rule from the current map: a rule added later refuses, a rule removed lets in", () => {
        const open = wam(area("a1", [meeting("Board")]));
        const closed = wam(area("a1", [meeting("Board"), onlyStaff]));
        expect(refusedAreaSpaces(open, ROOM, player)).toEqual([]);
        expect(refusedAreaSpaces(closed, ROOM, player)).toEqual([room("Board")]);
        expect(refusedAreaSpaces(open, ROOM, player)).toEqual([]);
    });

    it("uses a meeting room's id when it has no name", () => {
        const refused = refusedAreaSpaces(
            wam(area("a1", [{ ...meeting(""), id: "lk-1" } as Property, onlyStaff])),
            ROOM,
            player
        );
        expect(refused).toEqual([room("lk-1")]);
    });
});
