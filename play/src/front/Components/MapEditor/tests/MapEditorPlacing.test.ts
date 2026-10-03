import { describe, expect, it, vi } from "vitest";

vi.mock("../../../Phaser/Game/MapEditor/MapEditorModeManager", () => ({
    EditorToolName: {
        AreaEditor: "AreaEditor",
        EntityEditor: "EntityEditor",
        TrashEditor: "TrashEditor",
        ExploreTheRoom: "ExploreTheRoom",
    },
}));

import type { MapEditorPlacingInput } from "../MapEditorPlacing";
import { getMapEditorPlacingState } from "../MapEditorPlacing";

const idle: MapEditorPlacingInput = {
    selectedTool: undefined,
    entityPrefabName: undefined,
    areaMode: "ADD",
    areaSelected: false,
    botEditorMode: undefined,
    placingBotName: undefined,
};

describe("getMapEditorPlacingState", () => {
    it("places an entity once one is picked in the panel", () => {
        expect(getMapEditorPlacingState({ ...idle, selectedTool: "EntityEditor" })).toBeUndefined();
        expect(getMapEditorPlacingState({ ...idle, selectedTool: "EntityEditor", entityPrefabName: "Chair" })).toEqual({
            kind: "entity",
            name: "Chair",
        });
    });

    it("draws an area until one is selected for editing", () => {
        expect(getMapEditorPlacingState({ ...idle, selectedTool: "AreaEditor" })).toEqual({ kind: "area" });
        expect(
            getMapEditorPlacingState({ ...idle, selectedTool: "AreaEditor", areaMode: "EDIT", areaSelected: true })
        ).toBeUndefined();
    });

    it("treats the trash as acting on the map", () => {
        expect(getMapEditorPlacingState({ ...idle, selectedTool: "TrashEditor" })).toEqual({ kind: "trash" });
    });

    it("follows the bot editor's placing and waypoint modes", () => {
        expect(
            getMapEditorPlacingState({
                ...idle,
                selectedTool: "BotEditor",
                botEditorMode: "placing",
                placingBotName: "Greeter",
            })
        ).toEqual({ kind: "bot", name: "Greeter" });
        expect(
            getMapEditorPlacingState({ ...idle, selectedTool: "BotEditor", botEditorMode: "waypoint-edit" })
        ).toEqual({ kind: "waypoint" });
        expect(getMapEditorPlacingState({ ...idle, selectedTool: "BotEditor", botEditorMode: "list" })).toBeUndefined();
    });

    it("ignores bot modes left over when another tool is selected", () => {
        expect(
            getMapEditorPlacingState({ ...idle, selectedTool: "ExploreTheRoom", botEditorMode: "placing" })
        ).toBeUndefined();
    });
});
