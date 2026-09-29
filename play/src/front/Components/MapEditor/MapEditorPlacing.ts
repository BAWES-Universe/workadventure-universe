import { EditorToolName } from "../../Phaser/Game/MapEditor/MapEditorModeManager";

/**
 * "Placing" states: the user has picked something in the panel and now acts on the map.
 * While one is active the mobile sheet drops to peek and a hint bar floats over the map.
 */
export type MapEditorPlacingKind = "entity" | "bot" | "waypoint" | "area" | "trash";

export interface MapEditorPlacingState {
    kind: MapEditorPlacingKind;
    /** What is being placed, when it has a name. */
    name?: string;
}

export interface MapEditorPlacingInput {
    selectedTool: string | undefined;
    entityPrefabName: string | undefined;
    areaMode: "ADD" | "EDIT";
    areaSelected: boolean;
    botEditorMode: string | undefined;
    placingBotName: string | undefined;
}

export function getMapEditorPlacingState(input: MapEditorPlacingInput): MapEditorPlacingState | undefined {
    switch (input.selectedTool) {
        case EditorToolName.EntityEditor:
            return input.entityPrefabName !== undefined ? { kind: "entity", name: input.entityPrefabName } : undefined;
        case EditorToolName.AreaEditor:
            return input.areaMode === "ADD" && !input.areaSelected ? { kind: "area" } : undefined;
        case EditorToolName.TrashEditor:
            return { kind: "trash" };
        case "BotEditor":
            if (input.botEditorMode === "placing") {
                return { kind: "bot", name: input.placingBotName };
            }
            if (input.botEditorMode === "waypoint-edit") {
                return { kind: "waypoint" };
            }
            return undefined;
        default:
            return undefined;
    }
}
