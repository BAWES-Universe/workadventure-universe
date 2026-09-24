import type { Translation } from "../i18n-types";
import type { DeepPartial } from "../DeepPartial";

const say: DeepPartial<Translation["say"]> = {
    quickPhrases: {
        hi: "こんにちは 👋",
        brb: "すぐ戻ります",
        thanks: "ありがとう",
        ok: "OK",
    },
    type: {
        //say: "",
        //think: "",
    },
};

export default say;
