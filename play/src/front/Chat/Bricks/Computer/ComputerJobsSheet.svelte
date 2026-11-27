<script lang="ts">
    // Every job on a Brick's computer, opened by tapping the bar above its chat or a job on the computer page (steering mock,
    // approved 23 Nov). One sheet, three faces: the job rows, one job's Activity, and the question asked before several jobs stop
    // or a job that has run is cancelled. Opened straight at that question from Stop on the bar, the page or the Watch screen. Only reads and the person's own taps:
    // it never wakes a computer.
    import { onDestroy } from "svelte";
    import { fly } from "svelte/transition";
    import { closeModal } from "svelte-modals";
    import LL from "../../../../i18n/i18n-svelte";
    import { keepFocusInside } from "../keepFocusInside";
    import { brickComputers, followBrickComputer } from "./BrickComputerStore";
    import { allJobs, endQuestion, type ComputerJob } from "./BrickComputer";
    import { endAtOnce } from "./EndComputerJobs";
    import ComputerJobRows from "./ComputerJobRows.svelte";
    import ComputerJobActivity from "./ComputerJobActivity.svelte";
    import ComputerEndAsk from "./ComputerEndAsk.svelte";
    import type { BrickRef } from "./BrickScreenStore";
    import { IconX } from "@wa-icons";

    export let isOpen: boolean;
    export let brick: BrickRef;
    /** Where the sheet opens: the list (default), one job's Activity, or straight at the question. */
    export let start:
        | { face: "list" }
        | { face: "activity"; job: ComputerJob }
        | { face: "ask"; what: { stop: true } | { cancel: string } } = { face: "list" };
    /** Heard when Stop or Cancel ended something, so a host such as the Watch screen can close. */
    export let onEnded: (() => void) | undefined = undefined;
    /** Closes the sheet; svelte-modals by default. */
    export let close: () => void = closeModal;

    type Face =
        | { face: "list" }
        | { face: "activity"; job: ComputerJob }
        | { face: "ask"; what: { stop: true } | { cancel: string }; back: Face | null };
    let face: Face = start.face === "ask" ? { ...start, back: null } : start;

    const stopFollowing = followBrickComputer(brick.id);
    onDestroy(stopFollowing);

    $: view = $brickComputers.get(brick.id);
    $: jobs = allJobs(view);
    // Every job has gone (stopped, finished or cancelled): the list has nothing left to show
    // (only while this sheet is the open one: with another modal above it, closing would take that one away)
    $: if (isOpen && view && face.face === "list" && jobs.length === 0) close();

    // Cancel of a job that has run names it back first; one that never started goes at once
    function askCancel(job: ComputerJob) {
        const what = { cancel: job.id };
        if (endQuestion(view, what)) face = { face: "ask", what, back: face };
        else {
            const back = face;
            endAtOnce(brick, what)
                .then((ended) => {
                    // It began while the tap was on its way: nothing was cancelled, and it is asked about like a job that has run
                    if (ended === "started") face = { face: "ask", what, back };
                    else if (ended && back.face === "activity" && face === back) face = { face: "list" };
                })
                .catch((error) => console.error(error));
        }
    }
    function asked(ended: boolean) {
        if (face.face !== "ask") return;
        if (ended) onEnded?.();
        // Opened straight at the question: it was the whole errand. Otherwise back to where it was asked from, unless that job is gone
        const back = face.back;
        if (!back) close();
        else face = back.face === "activity" && ended ? { face: "list" } : back;
    }
</script>

{#if isOpen && view}
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div class="js-scrim" on:click|self={close}>
        <div
            class="js u-surface"
            role="dialog"
            aria-modal="true"
            aria-label={$LL.chat.brick.computer.machine({ name: brick.name })}
            data-testid="computerJobsSheet"
            use:keepFocusInside={close}
            transition:fly={{ y: 16, duration: 200 }}
        >
            {#if face.face !== "activity"}
                <button
                    type="button"
                    class="u-close absolute top-2 end-2"
                    aria-label={$LL.chat.brick.memory.close()}
                    data-testid="computerJobsSheetClose"
                    on:click={close}><IconX font-size="20" /></button
                >
            {/if}
            {#if face.face === "ask"}
                <ComputerEndAsk {brick} what={face.what} onDone={asked} />
            {:else if face.face === "activity"}
                <ComputerJobActivity
                    {brick}
                    {view}
                    jobId={face.job.id}
                    opened={face.job}
                    onBack={() => (face = { face: "list" })}
                    onCancel={askCancel}
                />
            {:else}
                <h2 class="js-title">{$LL.chat.brick.computer.machine({ name: brick.name })}</h2>
                <p class="js-sub">{$LL.chat.brick.computer.jobsSub({ name: brick.name })}</p>
                <ComputerJobRows
                    {brick}
                    {view}
                    {jobs}
                    onOpen={(job) => (face = { face: "activity", job })}
                    onCancel={askCancel}
                    onWatch={close}
                />
                <p class="js-note">{$LL.chat.brick.computer.jobsNote()}</p>
            {/if}
        </div>
    </div>
{/if}

<style>
    .js-scrim {
        position: fixed;
        inset: 0;
        z-index: 2001;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        background: rgba(0, 0, 0, 0.5);
        pointer-events: auto;
    }
    .js {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: 12px;
        box-sizing: border-box;
        width: 100%;
        max-width: 460px;
        max-height: 100%;
        margin: 0;
        padding: 20px;
        overflow-y: auto;
        border-radius: 20px;
        color: #fff;
        text-align: start;
        font-family: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    }
    @media (max-width: 640px) {
        .js-scrim {
            align-items: flex-end;
            padding: 0;
        }
        .js {
            max-width: none;
            padding-bottom: calc(20px + env(safe-area-inset-bottom));
            border-radius: 20px 20px 0 0;
        }
    }
    .js-title {
        margin: 0;
        font-family: inherit;
        text-transform: none;
        letter-spacing: normal;
        padding-inline-end: 40px;
        font-size: 1.25rem;
        line-height: 1.15;
        font-weight: 800;
    }
    .js-sub {
        margin: -6px 0 0;
        font-size: 13.5px;
        line-height: 1.4;
        color: rgba(244, 242, 250, 0.64);
    }
    .js-note {
        margin: 0;
        font-size: 13px;
        line-height: 1.4;
        color: rgba(244, 242, 250, 0.64);
    }
</style>
