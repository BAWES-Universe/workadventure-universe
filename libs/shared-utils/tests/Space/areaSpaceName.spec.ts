import { describe, expect, it } from "vitest";
import { slugify } from "../../src/Jitsi/slugify";
import { areaSpaceName, isAreaSpaceName } from "../../src/Space/areaSpaceName";

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

    it("names the same area differently in another room", () => {
        expect(areaSpaceName("Stage", ROOM)).not.toBe(areaSpaceName("Stage", OTHER_ROOM));
    });

    it("keeps its name when slugified again, as speaker zones are", () => {
        const name = areaSpaceName("Main Stage", ROOM);
        expect(slugify(name)).toBe(name);
    });

    it("keeps the name it always had for plain names, capitals and spaces included", () => {
        expect(areaSpaceName("Main Stage", ROOM)).toBe(areaSpaceName("main stage", ROOM));
        expect(areaSpaceName("mainstage", ROOM).endsWith("-mainstage")).toBe(true);
        expect(areaSpaceName("Café", ROOM)).toBe(areaSpaceName("cafe", ROOM));
    });

    it("keeps names slugify can't spell apart, and slug safe", () => {
        const arabic = areaSpaceName("مسرح", ROOM);
        const otherArabic = areaSpaceName("قاعة", ROOM);
        expect(arabic).not.toBe(otherArabic);
        expect(arabic).toBe(areaSpaceName(" مسرح ", ROOM));
        expect(slugify(arabic)).toBe(arabic);
        expect(areaSpaceName("Stage!", ROOM)).not.toBe(areaSpaceName("Stage", ROOM));
        expect(areaSpaceName("مسرح 1", ROOM)).not.toBe(areaSpaceName("قاعة 1", ROOM));
    });

    it("does not treat map script spaces as area spaces", () => {
        expect(isAreaSpaceName("my-script-space")).toBe(false);
        expect(isAreaSpaceName("allWorldUser")).toBe(false);
    });
});
