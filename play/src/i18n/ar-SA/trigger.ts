import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const trigger: DeepPartial<Translation["trigger"]> = {
    cowebsite: `[SPACE] لفتح الموقع الإلكتروني 👀`, // [SPACEBAR] to open the website 👀
    newTab: `[SPACE] لفتح تبويب جديد 👀`, // [SPACEBAR] to open a new tab 👀
    object: `[SPACE] للتفاعل 👀`, // [SPACEBAR] to interact 👀
    spaceKeyboard: `[SPACE]`, // [SPACEBAR]
    mobile: {
        cowebsite: "👆 لفتح الموقع الإلكتروني 👀", // 👆 to open the website 👀
        newTab: "👆 لفتح تبويب جديد 👀", // 👆 to open a new tab 👀
        object: "👆 للتفاعل 👀", // 👆 to interact 👀
    },
};

export default trigger;
