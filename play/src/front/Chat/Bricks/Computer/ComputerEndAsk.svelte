<script lang="ts">
    // The question asked before something ends (the approved steering mock): Stop that would end several jobs names each, with Keep
    // them or Stop all; Cancel of a job that has run names it back first. It reads the computer as it is now, so a job that ended
    // meanwhile is not asked about, and a question with nothing left to ask goes away by itself.
    import LL from "../../../../i18n/i18n-svelte";
    import { warningMessageStore } from "../../../Stores/ErrorStore";
    import { brickComputerAction, brickComputerJobAction, brickComputers } from "./BrickComputerStore";
    import { endQuestion, holdsComputer, isPaused } from "./BrickComputer";
    import { jobTitle, refusalWords } from "./ComputerJobWords";
    import type { BrickRef } from "./BrickScreenStore";

    export let brick: BrickRef;
    export let what: { stop: true } | { cancel: string };
    /** Called once the question is over: `ended` is true when something was stopped or cancelled, false when kept. */
    export let onDone: (ended: boolean) => void;

    let busy = false;
    let done = false;
    /** The question ends once, whatever ends it: an answer, a tap, or the jobs going away meanwhile. */
    function finish(ended: boolean) {
        if (done) return;
        done = true;
        onDone(ended);
    }

    $: view = $brickComputers.get(brick.id);
    $: asked = endQuestion(view, what);
    // Nothing left to ask about (it ended meanwhile): the question goes away by itself
    $: if (view && !asked && !busy) finish(false);
    $: stopping = "stop" in what;

    function run(call: () => Promise<boolean | string | null>, ended: boolean) {
        if (busy) return;
        busy = true;
        call()
            .then((outcome) => {
                if (outcome === true) {
                    finish(ended);
                    return;
                }
                if (typeof outcome === "string") warningMessageStore.addWarningMessage(outcome);
                else if (outcome === false) warningMessageStore.addWarningMessage($LL.chat.brick.computer.failed());
            })
            .catch((error) => console.error(error))
            .finally(() => {
                busy = false;
            });
    }

    const cancel = async (jobId: string): Promise<true | string | null> => {
        const answer = await brickComputerJobAction(brick.id, jobId, "cancel");
        return answer.ok ? true : refusalWords($LL, answer.why);
    };

    function end() {
        if (!asked) return;
        if (stopping) run(() => brickComputerAction(brick.id, "stop"), true);
        else if (asked.kind === "one") {
            const jobId = asked.job.id;
            run(() => cancel(jobId), true);
        }
    }
</script>

{#if asked}
    <div class="ea" role="alertdialog" aria-labelledby="computer-end-ask" data-testid="computerEndAsk">
        {#if asked.kind === "all"}
            <h2 id="computer-end-ask" class="ea-title">
                {$LL.chat.brick.computer.askStopAll({ count: asked.jobs.length })}
            </h2>
            <ul class="ea-lines">
                {#each asked.jobs as job (job.id)}
                    <li>
                        {holdsComputer(job)
                            ? $LL.chat.brick.computer.askStopsNow({ title: jobTitle($LL, job) })
                            : isPaused(job)
                            ? $LL.chat.brick.computer.askEndsTooPaused({ title: jobTitle($LL, job) })
                            : $LL.chat.brick.computer.askEndsTooWaiting({ title: jobTitle($LL, job) })}
                    </li>
                {/each}
                <li>{$LL.chat.brick.computer.askFilesKept()}</li>
            </ul>
            <p class="ea-note">{$LL.chat.brick.computer.askJustOne({ name: brick.name })}</p>
            <div class="ea-btns">
                <button
                    type="button"
                    class="ea-btn"
                    disabled={busy}
                    data-testid="computerEndAskKeep"
                    on:click={() => finish(false)}>{$LL.chat.brick.computer.keepThem()}</button
                >
                <button
                    type="button"
                    class="ea-btn coral"
                    disabled={busy}
                    data-testid="computerEndAskEnd"
                    on:click={end}>{$LL.chat.brick.computer.stopAll({ count: asked.jobs.length })}</button
                >
            </div>
        {:else}
            <h2 id="computer-end-ask" class="ea-title">
                {$LL.chat.brick.computer.askCancelOne({ title: jobTitle($LL, asked.job) })}
            </h2>
            <p class="ea-line">{$LL.chat.brick.computer.askEndsHere()}</p>
            <div class="ea-btns">
                <button
                    type="button"
                    class="ea-btn"
                    disabled={busy}
                    data-testid="computerEndAskKeep"
                    on:click={() => finish(false)}>{$LL.chat.brick.computer.keepIt()}</button
                >
                <button
                    type="button"
                    class="ea-btn coral"
                    disabled={busy}
                    data-testid="computerEndAskEnd"
                    on:click={end}>{$LL.chat.brick.computer.cancelJob()}</button
                >
            </div>
        {/if}
    </div>
{/if}

<style>
    .ea {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }
    .ea-title {
        margin: 0;
        font-family: inherit;
        text-transform: none;
        letter-spacing: normal;
        padding-inline-end: 40px;
        font-size: 1.25rem;
        line-height: 1.2;
        font-weight: 800;
        overflow-wrap: anywhere;
    }
    .ea-lines {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin: 0;
        padding-inline-start: 20px;
        font-size: 14px;
        line-height: 1.4;
        list-style: disc;
    }
    .ea-line {
        margin: 0;
        font-size: 14px;
        line-height: 1.45;
        color: rgba(244, 242, 250, 0.85);
    }
    .ea-note {
        margin: 0;
        font-size: 13px;
        line-height: 1.4;
        color: rgba(244, 242, 250, 0.64);
    }
    .ea-btns {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 10px;
        margin-top: 4px;
    }
    .ea-btn {
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
    .ea-btn.coral {
        background: #e8664f;
    }
    .ea-btn:disabled {
        opacity: 0.6;
    }
</style>
