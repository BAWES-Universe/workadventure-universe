import { get } from "svelte/store";
import LL from "../../../../i18n/i18n-svelte";
import { warningMessageStore } from "../../../Stores/ErrorStore";
import { brickComputerAction, brickComputerJobAction, brickComputerOf, loadBrickComputer } from "./BrickComputerStore";
import { jobsStopEnds } from "./BrickComputer";
import type { BrickRef } from "./BrickScreenStore";
import { refusalWords } from "./ComputerJobWords";

/** Ends what was tapped without a question, and says so when Orbit refused. True when it ended. */
export async function endAtOnce(brick: BrickRef, what: { stop: true } | { cancel: string }): Promise<boolean> {
    const texts = get(LL);
    if ("stop" in what) {
        // The job (or jobs) the panel shows at the tap go with the Stop: Orbit ends those, never one that began since (GPT's seventh note D2)
        const shown = jobsStopEnds(brickComputerOf(brick.id)).map((job) => job.id);
        if (shown.length === 0) {
            // Nothing on screen to stop: nothing is sent (a bare Stop would end whatever is live when it lands), and the page is read again
            await loadBrickComputer(brick.id);
            return true;
        }
        const ok = await brickComputerAction(brick.id, "stop", undefined, shown);
        if (!ok) warningMessageStore.addWarningMessage(texts.chat.brick.computer.failed());
        return ok;
    }
    const answer = await brickComputerJobAction(brick.id, what.cancel, "cancel");
    if (answer.ok) return true;
    const words = refusalWords(texts, answer.why);
    if (words) warningMessageStore.addWarningMessage(words);
    return false;
}
