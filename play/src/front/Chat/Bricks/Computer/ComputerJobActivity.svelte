<script lang="ts">
    // Activity: what one job has done so far, oldest first, with the time of each step, the person's own messages to it and where it
    // paused (steering mock, approved 23 Nov). Read only, from the steps the computer already reports; it never wakes the computer.
    // Below it, the buttons that job can take now: Cancel asks first, the host shows that question.
    import { onDestroy } from "svelte";
    import LL, { locale } from "../../../../i18n/i18n-svelte";
    import { warningMessageStore } from "../../../Stores/ErrorStore";
    import {
        brickComputerJobAction,
        followJobActivity,
        jobActivities,
        loadJobActivity,
        pendingJobCalls,
    } from "./BrickComputerStore";
    import { allJobs, jobControls, type BrickComputerView, type ComputerJob } from "./BrickComputer";
    import { jobTitle, refusalWords, rowLine } from "./ComputerJobWords";
    import type { BrickRef } from "./BrickScreenStore";
    import { IconCheck, IconChevronLeft, IconMessageCircle, IconPauseFilled, IconPlayerPlayFilled } from "@wa-icons";

    export let brick: BrickRef;
    export let view: BrickComputerView;
    export let jobId: string;
    /** The job as it was when it was opened: kept so its title still shows once it has ended. */
    export let opened: ComputerJob;
    export let onBack: () => void;
    export let onCancel: (job: ComputerJob) => void;

    let job: ComputerJob | null = null;
    $: job = allJobs(view).find((each) => each.id === jobId) ?? null;
    $: shown = job ?? opened;
    $: steps = $jobActivities.get(jobId);
    $: controls = jobControls(view, jobId);
    $: busy = ($pendingJobCalls.get(brick.id) ?? new Set<string>()).has(jobId);

    let failed = false;
    let stopFollowing: (() => void) | undefined;
    let followed: string | undefined;
    function follow(id: string) {
        if (id === followed) return;
        stopFollowing?.();
        followed = id;
        failed = false;
        stopFollowing = followJobActivity(brick.id, id, (read) => {
            if (followed === id) failed = read === undefined && $jobActivities.get(id) === undefined;
        });
    }
    $: follow(jobId);
    onDestroy(() => stopFollowing?.());

    function retry() {
        failed = false;
        loadJobActivity(brick.id, jobId)
            .then((read) => {
                failed = read === undefined;
            })
            .catch((error) => console.error(error));
    }

    function time(at: string | null): string {
        if (!at) return "";
        const when = new Date(at);
        return Number.isNaN(when.getTime())
            ? ""
            : when.toLocaleTimeString($locale || undefined, { hour: "numeric", minute: "2-digit" });
    }

    function act(control: "pause" | "resume" | "first") {
        brickComputerJobAction(brick.id, jobId, control)
            .then((answer) => {
                const words = answer.ok ? null : refusalWords($LL, answer.why);
                if (words) warningMessageStore.addWarningMessage(words);
            })
            .catch((error) => console.error(error));
    }
</script>

<div class="ja" data-testid="computerJobActivity">
    <div class="ja-hd">
        <button
            type="button"
            class="u-close ja-back"
            aria-label={$LL.chat.brick.computer.activityBack()}
            data-testid="computerJobActivityBack"
            on:click={onBack}><IconChevronLeft font-size="20" /></button
        >
        <div class="ja-hx">
            <h2 class="ja-title">{jobTitle($LL, shown)}</h2>
            {#if job}<p class="ja-sub">{rowLine($LL, view, job)}</p>{/if}
        </div>
    </div>
    <div class="ja-list">
        {#if steps && steps.length > 0}
            {#each steps as step (step.seq)}
                <div class="ja-st" class:you={step.kind === "note"}>
                    <span class="ja-dot" aria-hidden="true"
                        >{#if step.kind === "pause"}<IconPauseFilled
                                font-size="12"
                            />{:else if step.kind === "resume"}<IconPlayerPlayFilled
                                font-size="12"
                            />{:else if step.kind === "note"}<IconMessageCircle font-size="13" />{:else}<IconCheck
                                font-size="13"
                            />{/if}</span
                    >
                    <span class="ja-tx"
                        ><span class="ja-t">{step.label}</span>{#if step.detail}<span class="ja-m">{step.detail}</span
                            >{/if}</span
                    >
                    <span class="ja-tm">{time(step.at)}</span>
                </div>
            {/each}
        {:else if steps}
            <p class="ja-none" data-testid="computerJobActivityNone">{$LL.chat.brick.computer.activityNone()}</p>
        {:else if failed}
            <p class="ja-none">{$LL.chat.brick.computer.activityFailed()}</p>
            <div class="ja-btns">
                <button type="button" class="ja-btn" data-testid="computerJobActivityRetry" on:click={retry}
                    >{$LL.chat.brick.computer.activityRetry()}</button
                >
            </div>
        {/if}
    </div>
    {#if job && controls.length > 0}
        <div class="ja-btns">
            {#if controls.includes("cancel")}
                <button
                    type="button"
                    class="ja-btn"
                    disabled={busy}
                    data-testid="computerJobCancel"
                    on:click={() => job && onCancel(job)}>{$LL.chat.brick.computer.cancel()}</button
                >
            {/if}
            {#if controls.includes("pause")}
                <button
                    type="button"
                    class="ja-btn go"
                    disabled={busy}
                    data-testid="computerJobPause"
                    on:click={() => act("pause")}>{$LL.chat.brick.computer.pause()}</button
                >
            {:else if controls.includes("resume")}
                <button
                    type="button"
                    class="ja-btn go"
                    disabled={busy}
                    data-testid="computerJobResume"
                    on:click={() => act("resume")}>{$LL.chat.brick.computer.resume()}</button
                >
            {:else if controls.includes("first")}
                <button
                    type="button"
                    class="ja-btn go"
                    disabled={busy}
                    data-testid="computerJobFirst"
                    on:click={() => act("first")}>{$LL.chat.brick.computer.doThisNext()}</button
                >
            {/if}
        </div>
    {/if}
</div>

<style>
    .ja {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }
    .ja-hd {
        display: flex;
        align-items: flex-start;
        gap: 10px;
    }
    .ja-back {
        position: static;
        flex: none;
    }
    .ja-hx {
        min-width: 0;
    }
    .ja-title {
        margin: 0;
        font-family: inherit;
        text-transform: none;
        letter-spacing: normal;
        font-size: 1.25rem;
        line-height: 1.2;
        font-weight: 800;
        overflow-wrap: anywhere;
    }
    .ja-sub {
        margin: 2px 0 0;
        font-size: 13.5px;
        line-height: 1.4;
        color: rgba(244, 242, 250, 0.64);
    }
    .ja-list {
        display: flex;
        flex-direction: column;
    }
    .ja-st {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 7px 4px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }
    .ja-dot {
        flex: none;
        display: grid;
        place-items: center;
        width: 22px;
        height: 22px;
        margin-top: 1px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.08);
        color: rgba(255, 255, 255, 0.8);
    }
    .ja-st.you .ja-dot {
        background: rgba(134, 41, 252, 0.35);
        color: #fff;
    }
    .ja-tx {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
    }
    .ja-t {
        font-size: 13.5px;
        line-height: 1.35;
        overflow-wrap: anywhere;
    }
    .ja-m {
        font-size: 12px;
        color: rgba(244, 242, 250, 0.6);
    }
    .ja-tm {
        flex: none;
        padding-top: 2px;
        font-size: 12px;
        color: rgba(244, 242, 250, 0.55);
    }
    .ja-none {
        margin: 0;
        font-size: 13.5px;
        line-height: 1.4;
        color: rgba(244, 242, 250, 0.64);
    }
    .ja-btns {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 10px;
    }
    .ja-btn {
        height: 44px;
        margin: 0;
        padding: 0 18px;
        border: 0;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        font: inherit;
        font-size: 14px;
        font-weight: 700;
        color: #fff;
        cursor: pointer;
    }
    .ja-btn.go {
        background: linear-gradient(135deg, #8629fc, #4156f6);
    }
    .ja-btn:disabled {
        opacity: 0.6;
    }
</style>
