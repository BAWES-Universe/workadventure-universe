import type { Translation } from "../i18n-types";
import type { DeepPartial } from "../DeepPartial";

const say: DeepPartial<Translation["say"]> = {
    quickPhrases: {
        hi: "嗨 👋",
        brb: "马上回来",
        thanks: "谢谢",
        ok: "好的",
    },
    type: {
        //say: "",
        //think: "",
    },
};

export default say;
