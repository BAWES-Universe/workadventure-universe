import { describe, expect, it } from "vitest";
import { areaSpaceName } from "@workadventure/shared-utils/src/Space/areaSpaceName";
import { areaSpacesToLeave } from "../../src/pusher/services/AreaSpaceEviction";
import { toServerSpaceName } from "../../src/pusher/services/SpaceJoinPolicy";

const ROOM = "http://play.example.com/@/team/world/room";
const BOARD = areaSpaceName("Board", ROOM);
const STAGE = areaSpaceName("Stage", ROOM);
const CAFE = areaSpaceName("Cafe", ROOM);

function player(inSpaces: string[], rules: { refused?: string[]; listenOnly?: string[]; invited?: string[] } = {}) {
    const base = { world: "world", roomId: ROOM };
    const serverNames = inSpaces.map((name) => toServerSpaceName(base, name));
    return {
        ...base,
        spaces: new Set(serverNames),
        joinSpacesPromise: new Map(),
        refusedAreaSpaces: new Set(rules.refused ?? []),
        listenOnlyAreaSpaces: new Set(rules.listenOnly ?? []),
        invitedToSpeak: new Set(rules.invited ?? []),
    };
}

const server = (name: string) => toServerSpaceName({ world: "world", roomId: ROOM }, name);

describe("areaSpacesToLeave", () => {
    it("takes a player out of an area that is now limited to roles they do not have", () => {
        const data = player([BOARD, CAFE], { refused: [BOARD] });
        expect(areaSpacesToLeave(data, () => false)).toEqual([server(BOARD)]);
    });

    it("also covers a join that is still under way", () => {
        const data = player([], { refused: [BOARD] });
        data.joinSpacesPromise.set(server(BOARD), Promise.resolve());
        expect(areaSpacesToLeave(data, () => false)).toEqual([server(BOARD)]);
    });

    it("leaves alone areas the player is not in", () => {
        expect(areaSpacesToLeave(player([CAFE], { refused: [BOARD] }), () => false)).toEqual([]);
    });

    it("stops someone streaming on a stage they may now only listen to", () => {
        const data = player([STAGE], { listenOnly: [STAGE] });
        expect(areaSpacesToLeave(data, (name) => name === server(STAGE))).toEqual([server(STAGE)]);
    });

    it("keeps a listener of a listen-only stage, and a speaker who was invited", () => {
        expect(areaSpacesToLeave(player([STAGE], { listenOnly: [STAGE] }), () => false)).toEqual([]);
        const invited = player([STAGE], { listenOnly: [STAGE], invited: [STAGE] });
        expect(areaSpacesToLeave(invited, () => true)).toEqual([]);
    });
});
