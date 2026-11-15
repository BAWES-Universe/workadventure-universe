<script lang="ts">
    // A Brick's computer screen, opened from Watch (game #2000). You see what it is doing, can stop it, or take over the
    // mouse and keyboard and hand back. In control, Brick names what it is ready to put in and where, and one tap fills in
    // exactly that; paying and submitting are always yours. Watching only looks: it never wakes a computer, and a computer
    // that is resting has no screen to show.
    import { onMount } from "svelte";
    import LL from "../../../../i18n/i18n-svelte";
    import PanelHeader from "../../../Components/MapEditor/EditMode/PanelHeader.svelte";
    import PageButton from "../../../external-modules/bots/components/page/PageButton.svelte";
    import { warningMessageStore } from "../../../Stores/ErrorStore";
    import { brickComputerAction, brickComputers, followBrickComputer } from "./BrickComputerStore";
    import { canWatch, holdsComputer, sentenceStart } from "./BrickComputer";
    import type { BrickRef } from "./BrickScreenStore";
    import BrickScreenView from "./BrickScreenView.svelte";
    import { IconCircleCheck, IconHandFinger, IconId, IconLoader2 } from "@wa-icons";

    export let brick: BrickRef;
    export let onClose: () => void;

    $: view = $brickComputers.get(brick.id);
    $: job = view?.job ?? null;
    $: inControl = job?.control === "person";
    $: watching = canWatch(view);
    $: lastStep = job?.waitingFor === "pay" || job?.waitingFor === "submit";

    let busy = false;
    // The person tapped "Fill in my details" for what Brick named: once Brick has put it in, the tray says so
    let tapped = false;
    // Each new request for details is a round: the first sight of it, or the same words seen again after a gap, or other
    // words. A tap covers the round it was made in, so the next request needs its own tap, even when a read missed the gap
    // between them or the answer to the tap came after it.
    let tappedRound = 0;
    let round = 0;
    let lastKey = "";
    $: readyKey = job?.ready ? `${job.id}\n${job.ready.what}\n${job.ready.where}` : "";
    function noteReady(key: string) {
        if (key && key !== lastKey) round += 1;
        lastKey = key;
    }
    $: noteReady(readyKey);
    $: if (tapped && readyKey && tappedRound !== round) tapped = false;

    // The computer's own page opens the screen (see BrickScreenView); this page only follows what the job is doing
    onMount(() => followBrickComputer(brick.id));

    function act(action: "stop" | "take-over" | "hand-back" | "fill-details") {
        if (busy) return;
        busy = true;
        // The tap approves what is on screen: what Brick named is sent back, so Orbit refuses it if Brick named something else since
        const shown =
            action === "fill-details" && job?.ready ? { what: job.ready.what, where: job.ready.where } : undefined;
        // The round the tap was made in, kept now: the answer can come after a read has moved on to another request
        const roundAtTap = round;
        brickComputerAction(brick.id, action, shown)
            .then((ok) => {
                if (!ok) warningMessageStore.addWarningMessage($LL.chat.brick.computer.failed());
                else if (action === "fill-details") {
                    tapped = true;
                    tappedRound = roundAtTap;
                } else if (action === "stop") onClose();
                else if (action === "hand-back") tapped = false;
            })
            .catch((error) => console.error(error))
            .finally(() => {
                busy = false;
            });
    }
</script>

<div class="bs" data-testid="brickScreen">
    <PanelHeader
        title={$LL.chat.brick.computer.machine({ name: brick.name })}
        subtitle={inControl
            ? $LL.chat.brick.computer.screenInControl({ name: brick.name })
            : $LL.chat.brick.computer.screenWatching()}
        onBack={onClose}
        backLabel={$LL.chat.brick.computer.screenBack()}
        canHide={false}
    />
    <div class="bs-screen" class:ctl={inControl}>
        {#if watching}
            <BrickScreenView
                brickId={brick.id}
                title={$LL.chat.brick.computer.machine({ name: brick.name })}
                {inControl}
                active={watching}
            />
        {:else}
            <p class="bs-none" data-testid="brickScreenNone">{$LL.chat.brick.computer.screenNone()}</p>
        {/if}
    </div>

    {#if inControl && job?.ready && !tapped}
        <div class="bs-tray" data-testid="brickScreenReady">
            <span class="bs-ic"><IconId font-size="22" /></span>
            <span class="bs-tx"
                ><span class="bs-h">{$LL.chat.brick.computer.readyFor()}</span><span class="bs-l"
                    >{$LL.chat.brick.computer.readyLine({
                        what: sentenceStart(job.ready.what),
                        where: job.ready.where,
                    })}</span
                ></span
            >
        </div>
        <button
            type="button"
            class="bs-go"
            disabled={busy}
            data-testid="brickScreenFill"
            on:click={() => act("fill-details")}
            >{busy ? $LL.chat.brick.computer.filling() : $LL.chat.brick.computer.fillIn()}</button
        >
    {:else if inControl && tapped && !job?.ready}
        <div class="bs-tray" data-testid="brickScreenFilled">
            <span class="bs-ic ok"><IconCircleCheck font-size="22" /></span>
            <span class="bs-tx"
                ><span class="bs-h">{$LL.chat.brick.computer.filledIn()}</span><span class="bs-l"
                    >{$LL.chat.brick.computer.filledLine()}</span
                ></span
            >
        </div>
    {:else if inControl && lastStep}
        <div class="bs-last" data-testid="brickScreenLast">
            <span class="bs-h">{$LL.chat.brick.computer.lastStepYours()}</span>
            <span class="bs-l">{$LL.chat.brick.computer.lastStepLine({ name: brick.name })}</span>
        </div>
    {/if}

    <div class="bs-actions" class:watch={!inControl}>
        {#if !inControl && holdsComputer(job)}
            <div class="bs-now" data-testid="brickScreenNow">
                <span class="bs-spin"><IconLoader2 font-size="22" /></span>
                <span class="bs-tx"
                    ><span class="bs-h">{job?.stepLabel ?? job?.title}</span><span class="bs-l"
                        >{$LL.chat.brick.computer.screenWatchLine({ name: brick.name })}</span
                    ></span
                >
            </div>
        {/if}
        <div class="bs-btns">
            {#if inControl}
                <button
                    type="button"
                    class={lastStep ? "bs-go" : "bs-quiet"}
                    disabled={busy}
                    data-testid="brickScreenHandBack"
                    on:click={() => act("hand-back")}>{$LL.chat.brick.computer.handBack({ name: brick.name })}</button
                >
            {:else if holdsComputer(job)}
                <PageButton tall disabled={busy} testId="brickScreenStop" on:click={() => act("stop")}
                    >{$LL.chat.brick.computer.stop()}</PageButton
                >
                <button
                    type="button"
                    class="bs-take"
                    disabled={busy}
                    data-testid="brickScreenTakeOver"
                    on:click={() => act("take-over")}
                    ><IconHandFinger font-size="18" />{$LL.chat.brick.computer.takeOver()}</button
                >
            {/if}
        </div>
    </div>
</div>

<style>
    .bs {
        display: flex;
        flex-direction: column;
        gap: 10px;
        height: 100%;
        min-height: 0;
        padding: 14px 12px 12px;
        color: #fff;
    }
    .bs-screen {
        flex: 1;
        min-height: 0;
        overflow: hidden;
        border-radius: 16px;
        background: #0a0814;
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
    }
    /* In control the screen is outlined: it is yours now. */
    .bs-screen.ctl {
        box-shadow: 0 0 0 2px #8629fc, 0 0 18px rgba(134, 41, 252, 0.45);
    }
    .bs-none {
        display: grid;
        place-items: center;
        height: 100%;
        margin: 0;
        padding: 16px;
        text-align: center;
        font-size: 14px;
        color: rgba(244, 242, 250, 0.64);
    }
    .bs-tray,
    .bs-last {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding: 12px;
        border-radius: 14px;
        background: #0a0814;
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
    }
    .bs-last {
        flex-direction: column;
        gap: 2px;
        background: transparent;
        box-shadow: none;
        padding: 0 4px;
    }
    .bs-ic {
        flex: none;
        color: rgba(244, 242, 250, 0.8);
    }
    .bs-ic.ok {
        color: #34d399;
    }
    .bs-tx {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
    }
    .bs-h {
        font-size: 15px;
        font-weight: 700;
    }
    .bs-l {
        font-size: 12.5px;
        line-height: 1.35;
        color: rgba(244, 242, 250, 0.64);
    }
    .bs-actions {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }
    .bs-btns {
        display: flex;
        gap: 10px;
    }
    .bs-btns > :global(*) {
        flex: 1;
    }
    .bs-now {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 2px 6px;
    }
    .bs-spin {
        flex: none;
        display: grid;
        place-items: center;
        color: #a78bfa;
        animation: bs-turn 1.4s linear infinite;
    }
    @keyframes bs-turn {
        to {
            transform: rotate(360deg);
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .bs-spin {
            animation: none;
        }
    }
    /* Beside the chat there is room: the line that says what it is doing sits on the left, the two buttons stay compact on the right */
    @media (min-width: 1024px) {
        /* When the screen host is too narrow for both (the chat takes a lot of a 1024 px window), the buttons drop under the words */
        .bs-actions.watch {
            flex-direction: row;
            flex-wrap: wrap;
            align-items: center;
        }
        .bs-actions.watch .bs-now {
            flex: 1 1 200px;
            min-width: 0;
        }
        .bs-actions.watch .bs-btns {
            flex: 0 1 440px;
            max-width: 100%;
        }
        /* In control, the buttons stack at the same compact width on the right, as in the mock */
        .bs > .bs-go {
            align-self: flex-end;
            width: 440px;
            max-width: 100%;
        }
        .bs-actions:not(.watch) {
            align-items: flex-end;
        }
        .bs-actions:not(.watch) .bs-btns {
            width: 440px;
            max-width: 100%;
        }
    }
    .bs-go,
    .bs-quiet,
    .bs-take {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        width: 100%;
        height: 48px;
        margin: 0;
        border: 0;
        border-radius: 999px;
        font: inherit;
        font-size: 15px;
        font-weight: 700;
        color: #fff;
        cursor: pointer;
    }
    .bs-go,
    .bs-take {
        background: linear-gradient(135deg, #8629fc, #4156f6);
    }
    .bs-quiet {
        background: rgba(255, 255, 255, 0.08);
    }
    .bs-go:disabled,
    .bs-quiet:disabled,
    .bs-take:disabled {
        opacity: 0.6;
    }
</style>
