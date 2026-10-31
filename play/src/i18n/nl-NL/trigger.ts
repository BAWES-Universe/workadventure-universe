import type { Translation } from "../i18n-types";
import type { DeepPartial } from "../DeepPartial";

const trigger: DeepPartial<Translation["trigger"]> = {
    cowebsite: `[SPATIE] om de website te openen 👀`,
    newTab: "[SPATIE] om een nieuw tabblad te openen 👀",
    object: "[SPATIE] om ermee te interageren 👀",
    spaceKeyboard: "[SPATIE]",
    mobile: {
        cowebsite: "👆 om de website te openen 👀",
        newTab: "👆 om een nieuw tabblad te openen 👀",
        object: "👆 om ermee te interageren 👀",
    },
};

export default trigger;
