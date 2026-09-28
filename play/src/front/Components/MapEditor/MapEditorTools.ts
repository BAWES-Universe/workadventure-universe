import { derived, writable } from "svelte/store";
import { mapEditorActivated, mapEditorActivatedForThematics } from "../../Stores/MenuStore";
import { windowSize } from "../../Stores/CoWebsiteStore";
import type { TranslationFunctions } from "../../../i18n/i18n-types";
import { EditorToolName } from "../../Phaser/Game/MapEditor/MapEditorModeManager";
import { getMapEditorTools, MAP_EDITOR_MOBILE_MAX_WIDTH } from "./MapEditorToolList";
import type { MapEditorSheetSnap } from "./MapEditorSheet";

export const mapEditorToolsStore = derived(
    [mapEditorActivated, mapEditorActivatedForThematics],
    ([$mapEditorActivated, $mapEditorActivatedForThematics]) =>
        getMapEditorTools({
            mapEditorActivated: $mapEditorActivated,
            mapEditorActivatedForThematics: $mapEditorActivatedForThematics,
        })
);

export const mapEditorIsMobileLayoutStore = derived(
    windowSize,
    ($windowSize) => $windowSize.width < MAP_EDITOR_MOBILE_MAX_WIDTH
);

/** Snap point of the mobile bottom sheet. Ignored on desktop. */
export const mapEditorSheetSnapStore = writable<MapEditorSheetSnap>("half");

/** Human name of a map editor tool, including the bot editor added by the bots module. */
export function getMapEditorToolLabel(ll: TranslationFunctions, toolName: string | undefined): string {
    switch (toolName) {
        case EditorToolName.AreaEditor:
            return ll.mapEditor.sideBar.areaEditor();
        case EditorToolName.EntityEditor:
            return ll.mapEditor.sideBar.entityEditor();
        case EditorToolName.WAMSettingsEditor:
            return ll.mapEditor.sideBar.configureMyRoom();
        case EditorToolName.TrashEditor:
            return ll.mapEditor.sideBar.trashEditor();
        case EditorToolName.ExploreTheRoom:
            return ll.mapEditor.sideBar.exploreTheRoom();
        case "BotEditor":
            return ll.actionbar.botEditor();
        default:
            return "";
    }
}
