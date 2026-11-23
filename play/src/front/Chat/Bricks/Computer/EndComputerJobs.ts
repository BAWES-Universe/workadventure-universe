import { get } from "svelte/store";
import LL from "../../../../i18n/i18n-svelte";
import { warningMessageStore } from "../../../Stores/ErrorStore";
import { brickComputerAction, brickComputerJobAction } from "./BrickComputerStore";
import type { BrickRef } from "./BrickScreenStore";
import { refusalWords } from "./ComputerJobWords";

/** Ends what was tapped without a question, and says so when Orbit refused. True when it ended. */
export async function endAtOnce(brick: BrickRef, what: { stop: true } | { cancel: string }): Promise<boolean> {
    const texts = get(LL);
    if ("stop" in what) {
        const ok = await brickComputerAction(brick.id, "stop");
        if (!ok) warningMessageStore.addWarningMessage(texts.chat.brick.computer.failed());
        return ok;
    }
    const answer = await brickComputerJobAction(brick.id, what.cancel, "cancel");
    if (answer.ok) return true;
    const words = refusalWords(texts, answer.why);
    if (words) warningMessageStore.addWarningMessage(words);
    return false;
}
