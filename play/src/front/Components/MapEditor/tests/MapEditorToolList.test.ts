import { describe, expect, it, vi } from "vitest";

vi.mock("../../../Phaser/Game/MapEditor/MapEditorModeManager", () => ({
    EditorToolName: {
        AreaEditor: "AreaEditor",
        FloorEditor: "FloorEditor",
        EntityEditor: "EntityEditor",
        WAMSettingsEditor: "WAMSettingsEditor",
        TrashEditor: "TrashEditor",
        ExploreTheRoom: "ExploreTheRoom",
        CloseMapEditor: "CloseMapEditor",
    },
}));

import { getMapEditorTools } from "../MapEditorToolList";

const toolNames = (mapEditorActivated: boolean, mapEditorActivatedForThematics: boolean) =>
    getMapEditorTools({ mapEditorActivated, mapEditorActivatedForThematics }).map((tool) => tool.toolName);

describe("getMapEditorTools", () => {
    it("gives a room editor every tool", () => {
        expect(toolNames(true, false)).toEqual([
            "ExploreTheRoom",
            "AreaEditor",
            "EntityEditor",
            "WAMSettingsEditor",
            "TrashEditor",
        ]);
    });

    it("does not list a tool twice when both permissions are on", () => {
        expect(toolNames(true, true)).toEqual(toolNames(true, false));
    });

    it("gives a thematics editor the entity editor and trash", () => {
        expect(toolNames(false, true)).toEqual(["ExploreTheRoom", "EntityEditor", "TrashEditor"]);
    });

    it("only lets a visitor explore", () => {
        expect(toolNames(false, false)).toEqual(["ExploreTheRoom"]);
    });

    it("flags the area editor as working best on desktop", () => {
        const flagged = getMapEditorTools({ mapEditorActivated: true, mapEditorActivatedForThematics: false })
            .filter((tool) => tool.worksBestOnDesktop)
            .map((tool) => tool.toolName);
        expect(flagged).toEqual(["AreaEditor"]);
    });
});
