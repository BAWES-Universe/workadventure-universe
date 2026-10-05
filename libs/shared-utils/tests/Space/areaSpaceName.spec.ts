import { describe, expect, it } from "vitest";
import { slugify } from "../../src/Jitsi/slugify";
import { areaSpaceName, isAreaSpaceName, isAreaSpaceOfRoom } from "../../src/Space/areaSpaceName";

const ROOM = "https://play.example.com/@/universe/world/room";
const OTHER_ROOM = "https://play.example.com/@/universe/world/private-room";

describe("areaSpaceName", () => {
    it("names a meeting room after its room and marks it as an area space", () => {
        const name = areaSpaceName("Team Meeting", ROOM);
        expect(isAreaSpaceName(name)).toBe(true);
        expect(name.endsWith("-team-meeting")).toBe(true);
    });

    it("ignores spaces around the area name", () => {
        expect(areaSpaceName("  Stage ", ROOM)).toBe(areaSpaceName("Stage", ROOM));
    });

    it("tells the area spaces of a room from those of another room", () => {
        expect(isAreaSpaceOfRoom(areaSpaceName("Stage", ROOM), ROOM)).toBe(true);
        expect(isAreaSpaceOfRoom(areaSpaceName("Stage", OTHER_ROOM), ROOM)).toBe(false);
    });

    it("keeps its name when slugified again, as speaker zones are", () => {
        const name = areaSpaceName("Main Stage", ROOM);
        expect(slugify(name)).toBe(name);
    });

    it("does not treat map script spaces as area spaces", () => {
        expect(isAreaSpaceName("my-script-space")).toBe(false);
        expect(isAreaSpaceName("allWorldUser")).toBe(false);
    });
});
