import type { Translation } from "../i18n-types";
import type { DeepPartial } from "../DeepPartial";

const say: DeepPartial<Translation["say"]> = {
    quickPhrases: {
        hi: "Ciao 👋",
        brb: "Torno subito",
        thanks: "Grazie",
        ok: "OK",
    },
    type: {
        //say: "",
        //think: "",
    },
};

export default say;
