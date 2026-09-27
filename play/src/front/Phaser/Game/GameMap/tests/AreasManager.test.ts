import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AreaData } from "@workadventure/map-editor";

const accessibleAreaIds = new Set<string>();

vi.mock("@workadventure/map-editor", () => ({
    AreaPermissions: class {
        isUserHasAreaAccess(areaId: string): boolean {
            return accessibleAreaIds.has(areaId);
        }
        isOverlappingArea(): boolean {
            return false;
        }
    },
}));

vi.mock("../../../Entity/Area", () => ({
    Area: class {
        public destroy = vi.fn();
        constructor(public scene: unknown, public areaData: AreaData, public collide?: boolean) {}
    },
}));

vi.mock("../../../../Stores/MenuStore", () => ({ mapEditorActivatedForThematics: { set: vi.fn() } }));
vi.mock("../../../../Connection/LocalUserStore", () => ({
    localUserStore: { getLocalUser: () => ({ uuid: "me" }) },
}));

function makeArea(id: string): AreaData {
    return { id, name: id, x: 0, y: 0, width: 32, height: 32, visible: true, properties: [] } as AreaData;
}

async function makeAreasManager(initialAreas: AreaData[] = []) {
    const { AreasManager } = await import("../AreasManager");
    const gameMapAreas = {
        getAreas: () => new Map(initialAreas.map((area) => [area.id, area])),
        isGameMapContainsSpecificAreas: () => false,
    };
    const scene = { connection: { getAllTags: () => [] } };
    return new AreasManager(scene as never, gameMapAreas as never, [], false);
}

describe("AreasManager", () => {
    beforeEach(() => {
        accessibleAreaIds.clear();
    });

    it("makes an area added at runtime collide only for users without access", async () => {
        const manager = await makeAreasManager();
        accessibleAreaIds.add("open");

        manager.addArea(makeArea("open"));
        manager.addArea(makeArea("restricted"));

        expect((manager.getAreaById("open") as unknown as { collide: boolean }).collide).toBe(false);
        expect((manager.getAreaById("restricted") as unknown as { collide: boolean }).collide).toBe(true);
    });

    it("keeps the other areas when one area is removed", async () => {
        const manager = await makeAreasManager([makeArea("a"), makeArea("b"), makeArea("c")]);
        const destroyRemoved = (manager.getAreaById("b") as unknown as { destroy: () => void }).destroy;

        manager.removeArea("b");

        expect(destroyRemoved).toHaveBeenCalled();
        expect(manager.getAreaById("b")).toBeUndefined();
        expect(manager.getAreaById("a")).toBeDefined();
        expect(manager.getAreaById("c")).toBeDefined();
    });
});
