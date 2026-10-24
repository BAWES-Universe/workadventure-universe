import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const companion: DeepPartial<Translation["cowebsite"]> = {
    open: "Open",
    close: "Close",
    bigBlueButton: "BigBlueButton",
    jitsi: "Jitsi",
    copyLink: "Copy link",
    openInBrowserTab: "Open in browser tab",
    openCount: "{count} open",
    openList: "Open items",
    closeItem: "Close {name}",
    closeAll: "Close all",
    closedItems: "Closed {count} items",
    undo: "Undo",
    sheetHandle: "Window height: drag to resize, or drag down to tuck it away",
    compactView: "Return to compact view",
    fullScreenView: "Open full-screen view",
    resize: "Resize",
};

export default companion;
