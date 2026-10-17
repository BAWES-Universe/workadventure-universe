import { describe, expect, it, vi } from "vitest";
import type { AreaData, AreaDataProperty, GameMap, WAMFileFormat } from "@workadventure/map-editor";
import { GameMapAreas } from "@workadventure/map-editor";
import type { HookManager } from "../../../Modules/HookManager";
import { UpdateAreaMapStorageCommand } from "../UpdateAreaMapStorageCommand";

const highlight = (extra: { disabled?: boolean } = {}): AreaDataProperty => ({
    id: "p1",
    type: "highlight",
    opacity: 0.6,
    gradientWidth: 10,
    duration: 250,
    color: "#000000",
    ...extra,
});

const speaker: AreaDataProperty = { id: "p2", type: "speakerMegaphone", name: "Keynote", chatEnabled: false };

function setup(properties: AreaDataProperty[]) {
    const area: AreaData = { id: "a1", name: "a1", x: 0, y: 0, width: 32, height: 32, visible: true, properties };
    const areas = new GameMapAreas({
        version: "1.0.0",
        mapUrl: "map.tmj",
        entities: {},
        areas: [area],
        entityCollections: [],
    } as WAMFileFormat);
    const gameMap = { getGameMapAreas: () => areas } as unknown as GameMap;
    const hooks = {
        fireAreaPropertyAdd: vi.fn().mockResolvedValue(undefined),
        fireAreaPropertyDelete: vi.fn().mockResolvedValue(undefined),
        fireAreaPropertyChange: vi.fn().mockResolvedValue(undefined),
    };
    const update = async (next: AreaDataProperty[]) => {
        const command = new UpdateAreaMapStorageCommand(
            gameMap,
            { id: "a1", properties: next },
            undefined,
            undefined,
            hooks as unknown as HookManager,
            "localhost"
        );
        await command.execute();
    };
    return { areas, hooks, update };
}

describe("UpdateAreaMapStorageCommand property hooks", () => {
    it("fires the add hook for a whole property that is added", async () => {
        const { hooks, update } = setup([highlight()]);
        await update([highlight(), speaker]);
        expect(hooks.fireAreaPropertyAdd).toHaveBeenCalledTimes(1);
        expect(hooks.fireAreaPropertyAdd.mock.calls[0][1]).toMatchObject({ id: "p2", type: "speakerMegaphone" });
        expect(hooks.fireAreaPropertyDelete).not.toHaveBeenCalled();
    });

    it("fires the delete hook for a whole property that is removed", async () => {
        const { hooks, update } = setup([highlight(), speaker]);
        await update([highlight()]);
        expect(hooks.fireAreaPropertyDelete).toHaveBeenCalledTimes(1);
        expect(hooks.fireAreaPropertyDelete.mock.calls[0][1]).toMatchObject({ id: "p2", type: "speakerMegaphone" });
        expect(hooks.fireAreaPropertyAdd).not.toHaveBeenCalled();
    });

    it("fires no add or delete hook when a setting is switched off, and keeps it with its choices", async () => {
        const { areas, hooks, update } = setup([highlight(), speaker]);
        await update([highlight({ disabled: true }), speaker]);
        expect(hooks.fireAreaPropertyAdd).not.toHaveBeenCalled();
        expect(hooks.fireAreaPropertyDelete).not.toHaveBeenCalled();
        expect(areas.getArea("a1")?.properties[0]).toMatchObject({ id: "p1", disabled: true, color: "#000000" });
    });

    it("fires no add or delete hook when a setting is switched back on, and drops the flag", async () => {
        const { areas, hooks, update } = setup([highlight({ disabled: true }), speaker]);
        await update([highlight(), speaker]);
        expect(hooks.fireAreaPropertyAdd).not.toHaveBeenCalled();
        expect(hooks.fireAreaPropertyDelete).not.toHaveBeenCalled();
        expect(areas.getArea("a1")?.properties[0]).not.toHaveProperty("disabled");
    });

    it("still fires the change hook when a field of a setting changes", async () => {
        const { hooks, update } = setup([highlight(), speaker]);
        await update([highlight(), { ...speaker, name: "Town hall" } as AreaDataProperty]);
        expect(hooks.fireAreaPropertyChange).toHaveBeenCalledTimes(1);
        expect(hooks.fireAreaPropertyAdd).not.toHaveBeenCalled();
        expect(hooks.fireAreaPropertyDelete).not.toHaveBeenCalled();
    });
});
