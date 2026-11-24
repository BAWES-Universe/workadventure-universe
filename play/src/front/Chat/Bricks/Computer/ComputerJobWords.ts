import type { TranslationFunctions } from "../../../../i18n/i18n-types";
import type { JobRefusal } from "./BrickComputerStore";
import { jobRowState, type BrickComputerView, type ComputerJob, type WaitingFor } from "./BrickComputer";

/**
 * The words for a Brick's computer jobs, the same on the bar, the job rows, Activity and the Watch screen (steering mock, approved
 * 23 Nov). Never a number of minutes, a share of the month or a price.
 */

export const jobTitle = (texts: TranslationFunctions, job: ComputerJob): string =>
    job.title || texts.chat.brick.computer.untitledJob();

export function waitingWhat(texts: TranslationFunctions, waitingFor: WaitingFor | null): string {
    const words = texts.chat.brick.computer;
    switch (waitingFor) {
        case "details":
            return words.waitingDetails();
        case "signin":
            return words.waitingSignin();
        case "upload":
            return words.waitingUpload();
        case "pay":
            return words.waitingPay();
        case "submit":
            return words.waitingSubmit();
        default:
            return words.waitingAnswer();
    }
}

/** Where a working job is: its step and "step 2 of 5" when Orbit knows them, "getting it ready" until it does. */
export function stepLine(texts: TranslationFunctions, job: ComputerJob): string {
    const words = texts.chat.brick.computer;
    if (!job.stepTotal) return job.stepLabel ?? words.gettingReady();
    const of = words.stepOf({ done: job.stepDone, total: job.stepTotal });
    return job.stepLabel ? `${job.stepLabel} · ${of}` : of;
}

/** The line under a job's title in its row. */
export function rowLine(texts: TranslationFunctions, view: BrickComputerView, job: ComputerJob): string {
    const words = texts.chat.brick.computer;
    switch (jobRowState(view, job)) {
        case "waking":
            return words.rowWaking({ step: words.gettingReady() });
        case "working":
            return words.rowWorking({ step: stepLine(texts, job) });
        case "waiting-you":
            return words.barAskYou({ what: waitingWhat(texts, job.waitingFor) });
        case "paused":
            return job.pausedWhy === "allowance"
                ? words.rowPausedMonth()
                : job.pausedWhy === "rule"
                ? words.rowPausedRule()
                : words.rowPaused();
        case "comes-back":
            return words.rowComesBack();
        case "next":
            return words.rowNext();
        case "used-up":
            return words.rowUsedUp();
        case "busy":
            return words.rowBusy();
        default:
            return words.rowInLine();
    }
}

/** What to tell the person when Orbit said no to a tap on one job. Null when the page only had to be read again. */
export function refusalWords(texts: TranslationFunctions, why: JobRefusal): string | null {
    const words = texts.chat.brick.computer;
    switch (why) {
        case "taken-over":
            return words.refusedTakenOver();
        case "ending":
            return words.refusedEnding();
        case "gone":
            return words.refusedGone();
        case "out-of-time":
            return words.refusedOutOfTime();
        case "over-limit":
            return words.refusedOverLimit();
        // "started": it had started, the person is asked first (the panel opens the question), nothing to say here
        case "changed":
        case "started":
            return null;
        default:
            return words.failed();
    }
}
