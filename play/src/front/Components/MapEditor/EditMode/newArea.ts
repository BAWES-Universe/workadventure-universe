import { gameManager } from "../../../Phaser/Game/GameManager";
import type { AreaEditorTool } from "../../../Phaser/Game/MapEditor/Tools/AreaEditorTool";
import { editAreaDraftStore, editAreaDrawArmedStore } from "../../../Stores/EditModeStore";

/** "New area": nothing is picked any more, and the next drag on the map draws the new area's box. */
export function startNewArea(): void {
    (
        gameManager.tryGetCurrentGameScene()?.getMapEditorModeManager()?.currentlyActiveTool as
            | AreaEditorTool
            | undefined
    )?.deselectArea?.();
    editAreaDraftStore.set(undefined);
    editAreaDrawArmedStore.set(true);
}
