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
        mapEditorModeStore.switchMode(false);
    }
    showModalGlobalComminucationVisibilityStore.set(true);
    analyticsClient.globalMessage();
}
