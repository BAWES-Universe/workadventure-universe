import { get } from "svelte/store";
import { openedMenuStore } from "../../Stores/MenuStore";
import { chatVisibilityStore } from "../../Stores/ChatStore";
import {
    modalIframeStore,
    modalVisibilityStore,
    showModalGlobalComminucationVisibilityStore,
} from "../../Stores/ModalStore";
import { mapEditorModeStore } from "../../Stores/MapEditorStore";
import { analyticsClient } from "../../Administration/AnalyticsClient";
import { gameManager } from "../../Phaser/Game/GameManager";

/**
 * Opens the global message composer (text, audio, live megaphone) from any entry point,
 * clearing whatever would sit on top of it or fight for the screen.
 */
export function openGlobalMessageComposer(): void {
    openedMenuStore.closeAll();
    chatVisibilityStore.set(false);
    modalVisibilityStore.set(false);
    modalIframeStore.set(null);
    if (get(mapEditorModeStore)) {
        // Unequip first, like closing the editor does, so it doesn't reopen on the tool in use
        // here (Map overview, say) next time.
        gameManager.getCurrentGameScene().getMapEditorModeManager()?.equipTool(undefined);
        mapEditorModeStore.switchMode(false);
    }
    showModalGlobalComminucationVisibilityStore.set(true);
    analyticsClient.globalMessage();
}
