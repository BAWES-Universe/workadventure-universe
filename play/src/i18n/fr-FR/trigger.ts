import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const trigger: DeepPartial<Translation["trigger"]> = {
    cowebsite: "[ESPACE] pour ouvrir le site Web 👀",
    newTab: "[ESPACE] pour ouvrir un nouvel onglet 👀",
    object: "[ESPACE] pour interagir avec 👀",
    spaceKeyboard: "[ESPACE]",
    mobile: {
        cowebsite: "👆 pour ouvrir le site Web 👀",
        newTab: "👆 pour ouvrir un nouvel onglet 👀",
        object: "👆 pour interagir avec 👀",
    },
};

export default trigger;
