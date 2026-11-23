import { openModal } from "svelte-modals";
import { endQuestion, type ComputerJob } from "./BrickComputer";
import { brickComputerOf } from "./BrickComputerStore";
import type { BrickRef } from "./BrickScreenStore";
import { endAtOnce } from "./EndComputerJobs";
import ComputerJobsSheet from "./ComputerJobsSheet.svelte";

/** Every job on a Brick's computer, from the bar's line or a job on the computer page: the rows, or one job's Activity. */
export function openComputerJobs(brick: BrickRef, job?: ComputerJob): void {
    openModal(ComputerJobsSheet, { brick, start: job ? { face: "activity", job } : { face: "list" } });
}

/**
 * Stop, or Cancel of one job, from the panel (the approved steering mock). It asks first only when the mock does: Stop that would
 * end several jobs, and Cancel of a job that has run. Stop of a single job and Cancel of a job that never started end at once.
 * `onEnded` hears that something was stopped or cancelled (the Watch screen closes then); keeping the jobs says nothing.
 */
export function askToEnd(brick: BrickRef, what: { stop: true } | { cancel: string }, onEnded?: () => void): void {
    if (endQuestion(brickComputerOf(brick.id), what)) {
        openModal(ComputerJobsSheet, { brick, start: { face: "ask", what }, onEnded });
        return;
    }
    endAtOnce(brick, what)
        .then((ended) => {
            if (ended) onEnded?.();
        })
        .catch((error) => console.error(error));
}
