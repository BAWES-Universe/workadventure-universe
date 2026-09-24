import type { Translation } from "../i18n-types";
import type { DeepPartial } from "../DeepPartial";

const say: DeepPartial<Translation["say"]> = {
    quickPhrases: {
        hi: "Hola 👋",
        brb: "Ara torno",
        thanks: "Gràcies",
        ok: "D'acord",
    },
    type: {
        //say: "",
        //think: "",
    },
};

export default say;
