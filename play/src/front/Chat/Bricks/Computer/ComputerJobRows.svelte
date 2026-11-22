<script lang="ts">
    // The jobs of a Brick's computer, one row each, with the buttons that job can take (steering mock, approved 23 Nov). Working:
    // Pause and Watch. Paused: Cancel and Resume. Waiting further back: Cancel and Do this next. Next in line: Cancel. Tapping a job's
    // title opens what it has done so far. Cancel never acts here: the host asks first. Everything here can also be said to Brick.
    import LL from "../../../../i18n/i18n-svelte";
    import { warningMessageStore } from "../../../Stores/ErrorStore";
    import { brickComputerJobAction, pendingJobCalls } from "./BrickComputerStore";
    import { canWatch, jobControls, jobRowState, type BrickComputerView, type ComputerJob } from "./BrickComputer";
    import { jobTitle, refusalWords, rowLine } from "./ComputerJobWords";
    import { openBrickScreen, type BrickRef } from "./BrickScreenStore";
    import { IconChevronRight, IconClock, IconPauseFilled, IconPlayerPlayFilled } from "@wa-icons";

    export let brick: BrickRef;
    export let view: BrickComputerView;
    export let jobs: ComputerJob[];
    export let onOpen: (job: ComputerJob) => void;
    export let onCancel: (job: ComputerJob) => void;
    /** Watch is offered on the working job's row; the Watch screen itself leaves it out. */
    export let withWatch = true;

    $: pending = $pendingJobCalls.get(brick.id) ?? new Set<string>();

    function act(job: ComputerJob, control: "pause" | "resume" | "first") {
        brickComputerJobAction(brick.id, job.id, control)
            .then((answer) => {
                const words = answer.ok ? null : refusalWords($LL, answer.why);
                if (words) warningMessageStore.addWarningMessage(words);
            })
            .catch((error) => console.error(error));
    }
</script>

<div class="cj-rows" data-testid="computerJobRows">
    {#each jobs as job (job.id)}
        {@const state = jobRowState(view, job)}
        {@const controls = jobControls(view, job.id)}
        {@const busy = pending.has(job.id)}
        {@const running = state === "working" || state === "waking" || state === "waiting-you"}
        <div class="cj-row" class:on={running} data-testid="computerJob-{job.id}">
            <span class="cj-ico" aria-hidden="true"
                >{#if running}<IconPlayerPlayFilled
                        font-size="16"
                    />{:else if state === "paused" || state === "comes-back"}<IconPauseFilled
                        font-size="16"
                    />{:else}<IconClock font-size="18" />{/if}</span
            >
            <button type="button" class="cj-tx" data-testid="computerJobOpen" on:click={() => onOpen(job)}>
                <span class="cj-t">{jobTitle($LL, job)}<IconChevronRight class="cj-cv" font-size="14" /></span>
                <span class="cj-m">{rowLine($LL, view, job)}</span>
            </button>
            <span class="cj-bt">
                {#if running}
                    {#if controls.includes("pause")}
                        <button
                            type="button"
                            class="cj-btn"
                            disabled={busy}
                            data-testid="computerJobPause"
                            on:click={() => act(job, "pause")}>{$LL.chat.brick.computer.pause()}</button
                        >
                    {/if}
                    {#if withWatch && canWatch(view)}
                        <button
                            type="button"
                            class="cj-btn go"
                            data-testid="computerJobWatch"
                            on:click={() => openBrickScreen(brick)}
                            >{job.status === "waiting"
                                ? $LL.chat.brick.computer.takeOver()
                                : $LL.chat.brick.computer.watch()}</button
                        >
                    {/if}
                {:else}
                    {#if controls.includes("cancel")}
                        <button
                            type="button"
                            class="cj-btn"
                            disabled={busy}
                            data-testid="computerJobCancel"
                            on:click={() => onCancel(job)}>{$LL.chat.brick.computer.cancel()}</button
                        >
                    {/if}
                    {#if controls.includes("resume")}
                        <button
                            type="button"
                            class="cj-btn go"
                            disabled={busy}
                            data-testid="computerJobResume"
                            on:click={() => act(job, "resume")}>{$LL.chat.brick.computer.resume()}</button
                        >
                    {:else if controls.includes("first")}
                        <button
                            type="button"
                            class="cj-btn"
                            disabled={busy}
                            data-testid="computerJobFirst"
                            on:click={() => act(job, "first")}>{$LL.chat.brick.computer.doThisNext()}</button
                        >
                    {/if}
                {/if}
            </span>
        </div>
    {/each}
</div>

<style>
    .cj-rows {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    .cj-row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 8px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.04);
    }
    .cj-row.on {
        background: rgba(134, 41, 252, 0.16);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.45);
    }
    .cj-ico {
        flex: none;
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.08);
        color: rgba(255, 255, 255, 0.85);
    }
    .cj-row.on .cj-ico {
        color: #c4b5fd;
    }
    .cj-tx {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        margin: 0;
        padding: 0;
        border: 0;
        background: none;
        color: inherit;
        font: inherit;
        text-align: start;
        cursor: pointer;
    }
    .cj-t {
        font-size: 14px;
        font-weight: 700;
        overflow-wrap: anywhere;
    }
    .cj-t :global(.cj-cv) {
        vertical-align: -2px;
        margin-inline-start: 2px;
        color: rgba(244, 242, 250, 0.6);
    }
    .cj-m {
        font-size: 12.5px;
        line-height: 1.35;
        color: rgba(244, 242, 250, 0.64);
    }
    .cj-bt {
        flex: none;
        display: flex;
        gap: 6px;
    }
    .cj-btn {
        height: 44px;
        margin: 0;
        padding: 0 14px;
        border: 0;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        font: inherit;
        font-size: 13.5px;
        font-weight: 700;
        color: #fff;
        white-space: nowrap;
        cursor: pointer;
    }
    .cj-btn.go {
        background: linear-gradient(135deg, #8629fc, #4156f6);
    }
    .cj-btn:disabled {
        opacity: 0.6;
    }
</style>
