import type { Translation } from "../i18n-types";
import type { DeepPartial } from "../DeepPartial";

const say: DeepPartial<Translation["say"]> = {
    quickPhrases: {
        hi: "Hallo 👋",
        brb: "Gleich zurück",
        thanks: "Danke",
        ok: "OK",
    },
    type: {
        //say: "",
        //think: "",
    },
};

export default say;
