<script lang="ts">
    // The line above a Brick's chat while its computer has something to do (game #2000): what it is doing, with Stop and Watch
    // one tap away. Chat answers as fast as ever under it. It only reads: it never wakes a computer, and Watch is only offered
    // for a computer that is working.
    import { onMount } from "svelte";
    import LL from "../../../../i18n/i18n-svelte";
    import { warningMessageStore } from "../../../Stores/ErrorStore";
    import type { BrickCard } from "../Brick";
    import { brickComputerAction, brickComputers, followBrickComputer } from "./BrickComputerStore";
    import { barState, canWatch, type WaitingFor } from "./BrickComputer";
    import { openBrickScreen } from "./BrickScreenStore";
    import { IconDeviceDesktop } from "@wa-icons";

    export let brick: BrickCard;

    $: view = $brickComputers.get(brick.id);
    $: state = barState(view);
    $: job = view?.job ?? null;
    $: queued = view?.queued.length ?? 0;

    function waitingWhat(waitingFor: WaitingFor | null): string {
        switch (waitingFor) {
            case "details":
                return $LL.chat.brick.computer.waitingDetails();
            case "signin":
                return $LL.chat.brick.computer.waitingSignin();
            case "upload":
                return $LL.chat.brick.computer.waitingUpload();
            case "pay":
                return $LL.chat.brick.computer.waitingPay();
            case "submit":
                return $LL.chat.brick.computer.waitingSubmit();
            default:
                return $LL.chat.brick.computer.waitingAnswer();
        }
    }

    $: step = !job
        ? ""
        : job.stepTotal
        ? job.stepLabel
            ? `${job.stepLabel} · ${$LL.chat.brick.computer.stepOf({ done: job.stepDone, total: job.stepTotal })}`
            : $LL.chat.brick.computer.stepOf({ done: job.stepDone, total: job.stepTotal })
        : job.stepLabel ?? $LL.chat.brick.computer.gettingReady();
    $: line =
        state === "waking"
            ? $LL.chat.brick.computer.wakingUp()
            : state === "waiting"
            ? $LL.chat.brick.computer.barAskYou({ what: waitingWhat(job?.waitingFor ?? null) })
            : state === "working" && job
            ? job.title
                ? $LL.chat.brick.computer.barJob({ job: job.title, step })
                : step
            : state === "queued"
            ? view?.queued[0]?.queuedFor === "allowance"
                ? $LL.chat.brick.computer.barUsedUp()
                : $LL.chat.brick.computer.barInLine()
            : "";
    $: fullLine =
        queued > 0 && (state === "working" || state === "waiting")
            ? $LL.chat.brick.computer.barJobsWaiting({
                  line,
                  queued: $LL.chat.brick.computer.barQueued({ count: queued }),
              })
            : line;

    onMount(() => followBrickComputer(brick.id));

    let busy = false;
    function stop() {
        if (busy) return;
        busy = true;
        brickComputerAction(brick.id, "stop")
            .then((ok) => {
                if (!ok) warningMessageStore.addWarningMessage($LL.chat.brick.computer.failed());
            })
            .catch((error) => console.error(error))
            .finally(() => {
                busy = false;
            });
    }
</script>

{#if state}
    <div class="cb" data-testid="brickComputerBar">
        <span class="cb-ic"><IconDeviceDesktop font-size="24" /></span>
        <span class="cb-tx"
            ><span class="cb-h">{$LL.chat.brick.computer.machine({ name: brick.name })}</span><span class="cb-l"
                >{fullLine}</span
            ></span
        >
        <button type="button" class="cb-quiet" disabled={busy} data-testid="brickComputerBarStop" on:click={stop}
            >{$LL.chat.brick.computer.stop()}</button
        >
        {#if canWatch(view)}
            <button
                type="button"
                class="cb-go"
                data-testid="brickComputerBarWatch"
                on:click={() => openBrickScreen(brick)}
                >{state === "waiting" ? $LL.chat.brick.computer.takeOver() : $LL.chat.brick.computer.watch()}</button
            >
        {/if}
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
    .cb-quiet:disabled {
        opacity: 0.6;
    }
</style>
