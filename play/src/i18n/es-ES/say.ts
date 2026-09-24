import type { Translation } from "../i18n-types";
import type { DeepPartial } from "../DeepPartial";

const say: DeepPartial<Translation["say"]> = {
    quickPhrases: {
        hi: "Hola 👋",
        brb: "Ya vuelvo",
        thanks: "Gracias",
        ok: "OK",
    },
    type: {
        //say: "",
        //think: "",
    },
};

export default say;
