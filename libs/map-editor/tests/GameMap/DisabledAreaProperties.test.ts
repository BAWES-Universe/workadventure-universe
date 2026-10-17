import { describe, expect, it } from "vitest";
import { GameMapAreas } from "../../src/GameMap/GameMapAreas";
import type { AreaData, AreaDataProperty, WAMFileFormat } from "../../src/types";
import { AreaDataProperties } from "../../src/types";
import { getSpeakerMegaphoneAreaName, isAreaPropertyActive } from "../../src/Utils";

function area(id: string, properties: AreaDataProperty[]): AreaData {
    return { id, name: id, x: 0, y: 0, width: 32, height: 32, visible: true, properties };
}

function gameMapAreas(...areas: AreaData[]): GameMapAreas {
    return new GameMapAreas({
        version: "1.0.0",
        mapUrl: "map.tmj",
        entities: {},
        areas,
        entityCollections: [],
    } as WAMFileFormat);
}

const staffOnly = (extra: { disabled?: boolean } = {}): AreaDataProperty => ({
    id: "rights",
    type: "restrictedRightsPropertyData",
    readTags: ["staff"],
    writeTags: [],
    ...extra,
});

const desk = (extra: { disabled?: boolean } = {}): AreaDataProperty => ({
    id: "desk",
    type: "personalAreaPropertyData",
    accessClaimMode: "dynamic",
    allowedTags: [],
    ownerId: "owner-1",
    ...extra,
});

describe("isAreaPropertyActive", () => {
    it("is true unless the setting is switched off", () => {
        expect(isAreaPropertyActive({})).toBe(true);
        expect(isAreaPropertyActive({ disabled: false })).toBe(true);
        expect(isAreaPropertyActive({ disabled: undefined })).toBe(true);
        expect(isAreaPropertyActive({ disabled: true })).toBe(false);
    });
});

describe("the disabled flag in the schema", () => {
    it("is kept when a setting is parsed, and a setting without it stays without it", () => {
        const [off, on] = AreaDataProperties.parse([
            { id: "a", type: "silent", disabled: true },
            { id: "b", type: "silent" },
        ]);
        expect(off.disabled).toBe(true);
        expect("disabled" in on).toBe(false);
    });
});

describe("who can enter", () => {
    it("restricts an area whose rule is on", () => {
        const areas = gameMapAreas(area("a1", [staffOnly()]));
        expect(areas.isUserHasAreaAccess("a1", [])).toBe(false);
        expect(areas.isUserHasAreaAccess("a1", ["staff"])).toBe(true);
        expect(areas.getCollidingAreas([]).map((a) => a.id)).toEqual(["a1"]);
    });

    it("does not restrict an area whose rule is switched off", () => {
        const areas = gameMapAreas(area("a1", [staffOnly({ disabled: true })]));
        expect(areas.isUserHasAreaAccess("a1", [])).toBe(true);
        expect(areas.getCollidingAreas([]).length).toBe(0);
        expect(areas.isGameMapContainsSpecificAreas(undefined, ["staff"])).toBe(false);
    });
});

describe("personal desk", () => {
    it("is a desk (and overlapping) when on", () => {
        const areas = gameMapAreas(area("a1", [desk()]));
        expect(areas.isOverlappingArea("a1")).toBe(true);
        expect(areas.isGameMapContainsSpecificAreas("owner-1", [])).toBe(true);
    });

    it("does not count when switched off", () => {
        const areas = gameMapAreas(area("a1", [desk({ disabled: true })]));
        expect(areas.isOverlappingArea("a1")).toBe(false);
        expect(areas.isGameMapContainsSpecificAreas("owner-1", [])).toBe(false);
    });

    it("is still a desk with an owner for the editor, even when switched off", () => {
        const areas = gameMapAreas(area("a1", [desk({ disabled: true })]));
        expect(areas.isPersonalArea("a1")).toBe(true);
    });
});

describe("getSpeakerMegaphoneAreaName", () => {
    const stage = (disabled?: boolean): AreaDataProperty => ({
        id: "stage",
        type: "speakerMegaphone",
        name: "Keynote",
        chatEnabled: false,
        ...(disabled === undefined ? {} : { disabled }),
    });

    it("names a stage that is on", () => {
        const areas = new Map([["a1", area("a1", [stage()])]]);
        expect(getSpeakerMegaphoneAreaName(areas, "a1")).toBe("Keynote");
    });

    it("does not name a stage that is switched off", () => {
        const areas = new Map([["a1", area("a1", [stage(true)])]]);
        expect(getSpeakerMegaphoneAreaName(areas, "a1")).toBeUndefined();
    });
});
