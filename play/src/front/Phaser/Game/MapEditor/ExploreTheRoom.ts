import { get } from "svelte/store";
import { lookAroundBottomCoverStore } from "../../../Stores/LookAroundStore";
import {
    mapEditorModeStore,
    mapExplorationAreasStore,
    mapExplorationEntitiesStore,
    mapExplorationModeStore,
    mapExplorationObjectSelectedStore,
} from "../../../Stores/MapEditorStore";
import { gameManager } from "../GameManager";
import { EditorToolName, type MapEditorModeManager } from "./MapEditorModeManager";

/** Zooming out from this level starts the white fade that leads to "Look around the map". */
export const EXPLORE_ZOOM_OUT_START = 0.6;
/** Zooming out past this level enters "Look around the map"; entering by button glides out to it. */
export const EXPLORE_ZOOM_OUT_END = 0.3;
/** While looking around, zooming back in only leaves when the camera is this close to your avatar (world pixels). */
export const EXPLORE_ZOOM_IN_RADIUS_AROUND_WOKA = 320;

/**
 * Enter "Look around the map" (the ExploreTheRoom tool), turning the map editor mode on first if needed.
 * Never toggles: calling it while already looking around keeps looking around.
 */
export function enterExploreTheRoom(): void {
    // Without the map editor (ENABLE_MAP_EDITOR off) there is no tool to equip, and turning the
    // mode on would only show editor UI whose buttons have nothing behind them. Between two maps
    // there is no scene at all, and nothing to explore.
    const mapEditorModeManager: MapEditorModeManager | undefined = gameManager
        .tryGetCurrentGameScene()
        ?.getMapEditorModeManager();
    if (!mapEditorModeManager) return;
    if (!get(mapEditorModeStore)) {
        mapEditorModeStore.switchMode(true);
    }
    mapEditorModeManager.equipTool(EditorToolName.ExploreTheRoom);
}

/** Leave "Look around the map" and glide back to your avatar, like "Back to me". */
export function leaveExploreTheRoom(): void {
    // Equip the close tool first: it turns the mode off itself, so the editor does not remember
    // "Look around" as the tool to reopen with.
    const mapEditorModeManager = gameManager.tryGetCurrentGameScene()?.getMapEditorModeManager();
    if (mapEditorModeManager) {
        mapEditorModeManager.equipTool(EditorToolName.CloseMapEditor);
    } else {
        // Between two maps there is no scene and no tool to clear the looking-around state: clear it here, or the
        // "Look around" overlay and what it showed would linger until the old scene is destroyed.
        clearLookAroundStores();
    }
    if (get(mapEditorModeStore)) {
        mapEditorModeStore.switchMode(false);
    }
}

/** Forget everything "Look around" showed: the tool calls this when it closes, and leaving between two maps too. */
export function clearLookAroundStores(): void {
    mapExplorationObjectSelectedStore.set(undefined);
    mapExplorationModeStore.set(false);
    mapExplorationAreasStore.set(undefined);
    mapExplorationEntitiesStore.set(new Map());
    lookAroundBottomCoverStore.set(0);
}

/** True while "Look around the map" is open. */
export function isExploringTheRoom(): boolean {
    return get(mapExplorationModeStore);
}
