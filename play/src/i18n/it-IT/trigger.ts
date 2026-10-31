import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const trigger: DeepPartial<Translation["trigger"]> = {
    cowebsite: `[SPAZIO] per aprire il sito web 👀`,
    newTab: "[SPAZIO] per aprire una nuova scheda 👀",
    object: "[SPAZIO] per interagire con esso 👀",
    spaceKeyboard: "[SPAZIO]",
    mobile: {
        cowebsite: "👆 per aprire il sito web 👀",
        newTab: "👆 per aprire una nuova scheda 👀",
        object: "👆 per interagire con esso 👀",
    },
};

export default trigger;
