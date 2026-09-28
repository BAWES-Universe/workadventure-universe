import { get } from "svelte/store";
import { mapEditorModeStore } from "../../../Stores/MapEditorStore";
import { gameManager } from "../GameManager";
import { EditorToolName } from "./MapEditorModeManager";

/** Zooming out from this level starts the white fade that leads to "Explore the room". */
export const EXPLORE_ZOOM_OUT_START = 0.6;
/** Zooming out past this level enters "Explore the room". */
export const EXPLORE_ZOOM_OUT_END = 0.3;
/** While exploring, zooming back in only leaves when the camera is this close to your avatar (world pixels). */
export const EXPLORE_ZOOM_IN_RADIUS_AROUND_WOKA = 320;

/**
 * Enter "Explore the room", opening the map editor mode first if needed.
 * Never toggles: calling it while already exploring keeps exploring.
 */
export function enterExploreTheRoom(): void {
    if (!get(mapEditorModeStore)) {
        mapEditorModeStore.switchMode(true);
    }
    gameManager.getCurrentGameScene().getMapEditorModeManager()?.equipTool(EditorToolName.ExploreTheRoom);
}

/** Leave "Explore the room" and go back to your avatar, like "Show my location". */
export function leaveExploreTheRoom(): void {
    mapEditorModeStore.switchMode(false);
    gameManager.getCurrentGameScene().getMapEditorModeManager()?.equipTool(EditorToolName.CloseMapEditor);
}
