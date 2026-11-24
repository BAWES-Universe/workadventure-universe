<script lang="ts">
    // The line above a Brick's chat while its computer has something to do (game #2000): what it is doing, with Stop and Watch
    // one tap away. Chat answers as fast as ever under it. It only reads: it never wakes a computer, and Watch is only offered
    // for a computer that is working. Its line opens every job on the computer, Stop asks first, and a paused job shows Resume
    // (steering mock, approved 23 Nov).
    import { onDestroy } from "svelte";
    import LL from "../../../../i18n/i18n-svelte";
    import { warningMessageStore } from "../../../Stores/ErrorStore";
    import {
        brickComputerJobAction,
        brickComputers,
        dismissComputerNotice,
        followBrickComputer,
        pendingJobCalls,
    } from "./BrickComputerStore";
    import { barJob, barState, canWatch, holdsComputer, inLine, noticeToTell, sentenceStart } from "./BrickComputer";
    import { openBrickScreen, type BrickRef } from "./BrickScreenStore";
    import { refusalWords, stepLine, waitingWhat } from "./ComputerJobWords";
    import { askToEnd, openComputerJobs } from "./OpenComputerJobs";
    import { IconChevronRight, IconDeviceDesktop } from "@wa-icons";

    export let brick: BrickRef;

    $: view = $brickComputers.get(brick.id);
    $: state = barState(view);
    $: job = view?.job ?? null;
    // Only the jobs that start by themselves are "waiting": a paused one waits for the person's Resume
    $: waitingInLine = inLine(view);
    $: queued = waitingInLine.length;
    $: pausedJob = state === "paused" ? barJob(view) : null;
    $: pausedWords =
        pausedJob?.pausedWhy === "allowance"
            ? $LL.chat.brick.computer.barPausedMonth()
            : $LL.chat.brick.computer.barPaused();
    // Nothing is happening, and the last job ended in a way the person should hear about: said once, until dismissed or a new job starts
    $: notice = state ? null : noticeToTell(view);
    $: noticeLine = !notice
        ? ""
        : notice.how === "unanswered"
        ? $LL.chat.brick.computer.noticeUnanswered({ name: brick.name })
        : $LL.chat.brick.computer.noticeMonth({ name: brick.name });

    $: step = job ? stepLine($LL, job) : "";
    // A job "Do this first" put back in line carries on by itself right after: the bar names it ("· Visa form next")
    $: comesBack = holdsComputer(job) && waitingInLine[0]?.pausedBefore ? waitingInLine[0] : null;
    $: line =
        state === "waking"
            ? $LL.chat.brick.computer.wakingUp()
            : state === "waiting"
            ? $LL.chat.brick.computer.barAskYou({ what: waitingWhat($LL, job?.waitingFor ?? null) })
            : state === "working" && job
            ? job.title
                ? $LL.chat.brick.computer.barJob({ job: job.title, step })
                : step
            : state === "queued"
            ? waitingInLine[0]?.queuedFor === "allowance"
                ? $LL.chat.brick.computer.barUsedUp()
                : $LL.chat.brick.computer.barInLine()
            : state === "paused" && pausedJob
            ? pausedJob.title
                ? $LL.chat.brick.computer.barJob({ job: pausedJob.title, step: pausedWords })
                : sentenceStart(pausedWords)
            : "";
    $: fullLine =
        comesBack && (state === "working" || state === "waiting")
            ? $LL.chat.brick.computer.barNext({ line, title: comesBack.title || $LL.chat.brick.computer.untitledJob() })
            : queued > 0 && (state === "working" || state === "waiting")
            ? $LL.chat.brick.computer.barJobsWaiting({
                  line,
                  queued: $LL.chat.brick.computer.barQueued({ count: queued }),
              })
            : line;

    // Follows the Brick whose chat this is, by its id alone, so a new Brick object with the same id starts nothing again
    let stopFollowing: (() => void) | undefined;
    let followed: string | undefined;
    function follow(id: string) {
        if (id === followed) return;
        stopFollowing?.();
        followed = id;
        stopFollowing = followBrickComputer(id);
    }
    $: brickId = brick.id;
    $: follow(brickId);
    onDestroy(() => stopFollowing?.());

    let busy = false;
    function dismiss() {
        if (busy || !notice) return;
        busy = true;
        dismissComputerNotice(brick.id, notice.jobId)
            .catch((error) => console.error(error))
            .finally(() => {
                busy = false;
            });
    }
    // Stop ends every job on the computer: it asks first when that is several jobs, and ends a single job at once. Off from the tap until its request is over, so a second tap sends no second Stop
    let stopping = false;
    function stop() {
        if (busy || stopping) return;
        stopping = true;
        void askToEnd(brick, { stop: true }).finally(() => {
            stopping = false;
        });
    }

    $: resuming = !!pausedJob && ($pendingJobCalls.get(brick.id)?.has(pausedJob.id) ?? false);
    function resume() {
        if (!pausedJob || resuming) return;
        brickComputerJobAction(brick.id, pausedJob.id, "resume")
            .then((answer) => {
                const words = answer.ok ? null : refusalWords($LL, answer.why);
                if (words) warningMessageStore.addWarningMessage(words);
            })
            .catch((error) => console.error(error));
    }
</script>

{#if state}
    <div class="cb" data-testid="brickComputerBar">
        <span class="cb-ic"><IconDeviceDesktop font-size="24" /></span>
        <button
            type="button"
            class="cb-tx"
            aria-label={$LL.chat.brick.computer.jobsOpen({ name: brick.name })}
            data-testid="brickComputerBarOpen"
            on:click={() => openComputerJobs(brick)}
            ><span class="cb-h"
                >{$LL.chat.brick.computer.machine({ name: brick.name })}<IconChevronRight
                    class="cb-cv"
                    font-size="15"
                /></span
            ><span class="cb-l">{fullLine}</span></button
        >
        <button
            type="button"
            class="cb-quiet"
            disabled={busy || stopping}
            data-testid="brickComputerBarStop"
            on:click={stop}>{$LL.chat.brick.computer.stop()}</button
        >
        {#if state === "paused" && pausedJob}
            <button
                type="button"
                class="cb-go"
                disabled={resuming}
                data-testid="brickComputerBarResume"
                on:click={resume}>{$LL.chat.brick.computer.resume()}</button
            >
        {:else if canWatch(view)}
            <button
                type="button"
                class="cb-go"
                data-testid="brickComputerBarWatch"
                on:click={() => openBrickScreen(brick)}
                >{state === "waiting" ? $LL.chat.brick.computer.takeOver() : $LL.chat.brick.computer.watch()}</button
            >
        {/if}
    </div>
{:else if notice}
    <div class="cb" data-testid="brickComputerBarNotice">
        <span class="cb-ic"><IconDeviceDesktop font-size="24" /></span>
        <span class="cb-tx"><span class="cb-l cb-n">{noticeLine}</span></span>
        <button
            type="button"
            class="cb-quiet"
            disabled={busy}
            data-testid="brickComputerBarNoticeDismiss"
            on:click={dismiss}>{$LL.chat.brick.computer.noticeDismiss()}</button
        >
    </div>
{/if}

<style>
    .cb {
        display: flex;
        align-items: center;
        gap: 10px;
        margin: 0 8px;
        padding: 8px 10px;
        border-radius: 16px;
        background: rgba(10, 9, 24, 0.72);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.3), 0 0 22px rgba(134, 41, 252, 0.16);
        color: #fff;
    }
    .cb-ic {
        flex: none;
        display: grid;
        place-items: center;
        color: rgba(244, 242, 250, 0.9);
    }
    .cb-tx {
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: 1px;
        min-width: 0;
        margin: 0;
        padding: 0;
        border: 0;
        background: none;
        color: inherit;
        font: inherit;
        text-align: start;
        cursor: pointer;
    }
    /* The notice is a sentence, not a way into the jobs */
    span.cb-tx {
        cursor: default;
    }
    .cb-h :global(.cb-cv) {
        vertical-align: -3px;
        margin-inline-start: 2px;
        color: rgba(244, 242, 250, 0.8);
    }
    .cb-h {
        font-size: 14px;
        font-weight: 700;
    }
    .cb-l {
        font-size: 12px;
        line-height: 1.3;
        color: rgba(244, 242, 250, 0.64);
    }
    /* A notice is a sentence, not a title and a line: it reads as the main text */
    .cb-n {
        font-size: 13px;
        color: rgba(244, 242, 250, 0.9);
    }
    .cb-quiet,
    .cb-go {
        flex: none;
        height: 44px;
        margin: 0;
        padding: 0 16px;
        border: 0;
        border-radius: 999px;
        font: inherit;
        font-size: 14px;
        font-weight: 700;
        color: #fff;
        cursor: pointer;
    }
    .cb-quiet {
        background: rgba(255, 255, 255, 0.1);
    }
    .cb-go {
        background: linear-gradient(135deg, #8629fc, #4156f6);
    }
    .cb-quiet:disabled,
    .cb-go:disabled {
        opacity: 0.6;
    }
</style>
