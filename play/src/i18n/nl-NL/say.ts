import type { Translation } from "../i18n-types";
import type { DeepPartial } from "../DeepPartial";

const say: DeepPartial<Translation["say"]> = {
    quickPhrases: {
        hi: "Hoi 👋",
        brb: "Zo terug",
        thanks: "Bedankt",
        ok: "OK",
    },
    type: {
        //say: "",
        //think: "",
    },
};

export default say;
