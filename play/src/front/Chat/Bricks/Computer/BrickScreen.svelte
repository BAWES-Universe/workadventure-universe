<script lang="ts">
    // A Brick's computer screen, opened from Watch (game #2000). You see what it is doing, can stop it, or take over the
    // mouse and keyboard and hand back. In control, Brick names what it is ready to put in and where, and one tap fills in
    // exactly that; paying and submitting are always yours. Watching only looks: it never wakes a computer, and a computer
    // that is resting has no screen to show.
    import { onMount } from "svelte";
    import LL from "../../../../i18n/i18n-svelte";
    import PanelHeader from "../../../Components/MapEditor/EditMode/PanelHeader.svelte";
    import PageButton from "../../../external-modules/bots/components/page/PageButton.svelte";
    import { botApiService } from "../../../external-modules/bots/services/BotApiService";
    import { warningMessageStore } from "../../../Stores/ErrorStore";
    import { brickComputerAction, brickComputers, followBrickComputer } from "./BrickComputerStore";
    import { canWatch, holdsComputer } from "./BrickComputer";
    import type { BrickRef } from "./BrickScreenStore";
    import { IconCircleCheck, IconHandFinger, IconId, IconLoader2 } from "@wa-icons";

    export let brick: BrickRef;
    export let onClose: () => void;

    /** A watch link lasts a few minutes: it is asked for again before it runs out. */
    const RENEW_MS = 4 * 60 * 1000;

    $: view = $brickComputers.get(brick.id);
    $: job = view?.job ?? null;
    $: inControl = job?.control === "person";
    $: watching = canWatch(view);
    $: lastStep = job?.waitingFor === "pay" || job?.waitingFor === "submit";

    let url: string | undefined;
    let looked = false;
    let busy = false;
    // The person tapped "Fill in my details" for what Brick named: once Brick has put it in, the tray says so
    let tapped = false;

    function look() {
        botApiService
            .watchBrickComputer(brick.id)
            .then((answer) => {
                url = answer?.url;
                looked = true;
            })
            .catch((error) => console.error(error));
    }

    onMount(() => {
        const stop = followBrickComputer(brick.id);
        look();
        const renew = setInterval(look, RENEW_MS);
        // The computer got work again after the screen was open with nothing to show: ask for its screen once more
        const again = brickComputers.subscribe((all) => {
            if (looked && !url && canWatch(all.get(brick.id))) look();
        });
        return () => {
            stop();
            again();
            clearInterval(renew);
        };
    });

    // The job ended or the computer rested while the screen was open: there is nothing to watch, and nothing is woken
    $: shownUrl = watching ? url : undefined;

    function act(action: "stop" | "take-over" | "hand-back" | "fill-details") {
        if (busy) return;
        busy = true;
        brickComputerAction(brick.id, action)
            .then((ok) => {
                if (!ok) warningMessageStore.addWarningMessage($LL.chat.brick.computer.failed());
                else if (action === "fill-details") tapped = true;
                else if (action === "stop") onClose();
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
        {#if shownUrl}
            <iframe
                class="bs-frame"
                title={$LL.chat.brick.computer.machine({ name: brick.name })}
                src={shownUrl}
                sandbox="allow-scripts allow-same-origin allow-forms"
                referrerpolicy="no-referrer"
                data-testid="brickScreenFrame"
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
                    >{$LL.chat.brick.computer.readyLine({ what: job.ready.what, where: job.ready.where })}</span
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
    .bs-frame {
        display: block;
        width: 100%;
        height: 100%;
        border: 0;
        background: #fff;
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
        .bs-actions.watch {
            flex-direction: row;
            align-items: center;
        }
        .bs-actions.watch .bs-now {
            flex: 1;
            min-width: 0;
        }
        .bs-actions.watch .bs-btns {
            flex: none;
            width: 440px;
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
