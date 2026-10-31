import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const trigger: DeepPartial<Translation["trigger"]> = {
    cowebsite: `[LEERTASTE] um die Webseite zu öffnen 👀`,
    newTab: "[LEERTASTE] um neuen Tab zu öffnen 👀",
    object: "[LEERTASTE] um zu interagieren 👀",
    spaceKeyboard: "[LEERTASTE]",
    mobile: {
        cowebsite: "👆 um die Webseite zu öffnen 👀",
        newTab: "👆 um neuen Tab zu öffnen 👀",
        object: "👆 um zu interagieren 👀",
    },
};

export default trigger;
