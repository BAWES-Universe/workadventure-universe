import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const companion: DeepPartial<Translation["cowebsite"]> = {
    open: "Open",
    close: "Close",
    bigBlueButton: "BigBlueButton",
    jitsi: "Jitsi",
    copyLink: "Copy link",
    openInBrowserTab: "Open in browser tab",
};

export default companion;
