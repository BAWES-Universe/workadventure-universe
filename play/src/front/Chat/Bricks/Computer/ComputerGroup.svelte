<script lang="ts">
    // A Brick's computer on its page (game #2000), laid out the way Voice is: off is a way in that says what it is for and has
    // one button that says what it does; on is a card with what it is doing now, how much of the month is left, its files, and
    // a quiet button to turn it off. No switch, no sizes, no provider or engine names. The styles are the Voice group's own.
    import { onMount } from "svelte";
    import LL, { locale } from "../../../../i18n/i18n-svelte";
    import PageGroup from "../../../external-modules/bots/components/page/PageGroup.svelte";
    import PageButton from "../../../external-modules/bots/components/page/PageButton.svelte";
    import { warningMessageStore } from "../../../Stores/ErrorStore";
    import { shortDay } from "../Brick";
    import { brickComputerAction, brickComputers, followBrickComputer } from "./BrickComputerStore";
    import { canWatch, fileSize, holdsComputer, monthWord } from "./BrickComputer";
    import { openBrickScreen, type BrickRef } from "./BrickScreenStore";
    import {
        IconDeviceDesktop,
        IconFileSpreadsheet,
        IconWorld,
        IconClipboardText,
        IconTicket,
        IconEye,
        IconFolder,
        IconSparkles,
        IconChevronRight,
    } from "@wa-icons";

    export let brick: BrickRef;
    export let open = false;
    export let onToggle: (id: string) => void;
    /** The Usage page, when the game has one for a Brick (#1999): the month's "Usage" link. */
    export let onUsage: (() => void) | undefined = undefined;

    let busy = false;
    $: view = $brickComputers.get(brick.id);
    $: name = brick.name;
    $: job = view?.job ?? null;
    $: active = holdsComputer(job) ? job : null;
    $: working = active !== null;
    $: brief = !view
        ? ""
        : !view.available
        ? $LL.chat.brick.computer.briefNotOpen()
        : !view.on
        ? $LL.chat.brick.computer.briefOff({ name })
        : job?.status === "waiting"
        ? $LL.chat.brick.computer.briefWaiting()
        : active
        ? active.title
            ? $LL.chat.brick.computer.briefWorking({ job: active.title })
            : $LL.chat.brick.computer.briefWorkingNoJob()
        : $LL.chat.brick.computer.briefResting();
    $: month = view?.month ?? null;
    $: monthText = !month
        ? ""
        : {
              plenty: $LL.chat.brick.computer.monthPlenty(),
              half: $LL.chat.brick.computer.monthHalf(),
              little: $LL.chat.brick.computer.monthLittle(),
              none: $LL.chat.brick.computer.monthNone(),
              unlimited: $LL.chat.brick.computer.monthUnlimited(),
          }[monthWord(month)];
    $: monthDay = month ? shortDay(month.endsAt, $locale) : "";
    $: filesLine = !view
        ? ""
        : view.files.savedAt
        ? $LL.chat.brick.computer.filesLine({ size: fileSize(view.files.bytes) })
        : $LL.chat.brick.computer.filesNone();
    // The line says which step it is on, not what the step is: the bar above the chat says that. It keeps this card to two lines.
    $: stepLine = !active
        ? ""
        : active.stepTotal
        ? $LL.chat.brick.computer.stepOf({ done: active.stepDone, total: active.stepTotal })
        : active.stepLabel ?? $LL.chat.brick.computer.gettingReady();

    onMount(() => followBrickComputer(brick.id));

    function act(action: "give" | "turn-off" | "stop") {
        if (busy) return;
        busy = true;
        brickComputerAction(brick.id, action)
            .then((ok) => {
                if (!ok) warningMessageStore.addWarningMessage($LL.chat.brick.computer.failed());
            })
            .catch((error) => console.error(error))
            .finally(() => {
                busy = false;
            });
    }
</script>

{#if view}
    <PageGroup id="computer" icon={IconDeviceDesktop} title={$LL.chat.brick.computer.title()} {brief} {open} {onToggle}>
        <div class="cg" data-testid="brickComputer">
            {#if !view.available}
                <p class="lead" data-testid="brickComputerNotOpen">{$LL.chat.brick.computer.notOpen()}</p>
            {:else if !view.on}
                <p class="lead">{$LL.chat.brick.computer.lead({ name })}</p>
                <div class="bp-cap">{$LL.chat.brick.computer.whatItsFor()}</div>
                <div class="vg-tap">
                    <span class="vg-ico"><IconClipboardText font-size="20" /></span>
                    <span class="bp-mtx"
                        ><span class="vg-t">{$LL.chat.brick.computer.forForms()}</span><span class="bp-cn"
                            >{$LL.chat.brick.computer.forFormsLine()}</span
                        ></span
                    >
                </div>
                <div class="vg-tap">
                    <span class="vg-ico"><IconTicket font-size="20" /></span>
                    <span class="bp-mtx"
                        ><span class="vg-t">{$LL.chat.brick.computer.forBookings()}</span><span class="bp-cn"
                            >{$LL.chat.brick.computer.forBookingsLine()}</span
                        ></span
                    >
                </div>
                <div class="vg-tap">
                    <span class="vg-ico"><IconWorld font-size="20" /></span>
                    <span class="bp-mtx"
                        ><span class="vg-t">{$LL.chat.brick.computer.forSites()}</span><span class="bp-cn"
                            >{$LL.chat.brick.computer.forSitesLine()}</span
                        ></span
                    >
                </div>
                <div class="vg-tap">
                    <span class="vg-ico"><IconFileSpreadsheet font-size="20" /></span>
                    <span class="bp-mtx"
                        ><span class="vg-t">{$LL.chat.brick.computer.forFiles()}</span><span class="bp-cn"
                            >{$LL.chat.brick.computer.forFilesLine()}</span
                        ></span
                    >
                </div>
                <div class="vg-tap">
                    <span class="vg-ico"><IconEye font-size="20" /></span>
                    <span class="bp-mtx"
                        ><span class="vg-t">{$LL.chat.brick.computer.forCharge()}</span><span class="bp-cn"
                            >{$LL.chat.brick.computer.forChargeLine()}</span
                        ></span
                    >
                </div>
                <button
                    type="button"
                    class="vg-go"
                    disabled={busy}
                    data-testid="brickComputerGive"
                    on:click={() => act("give")}
                >
                    {busy ? $LL.chat.brick.computer.giving() : $LL.chat.brick.computer.give({ name })}
                </button>
                <p class="bp-note">
                    <IconSparkles font-size="14" /><span>{$LL.chat.brick.computer.giveNote()}</span>
                </p>
            {:else}
                <p class="lead">{$LL.chat.brick.computer.leadOn({ name })}</p>
                <div class="bp-model" data-testid="brickComputerState">
                    <div class="bp-mtx">
                        <span class="bp-cap">{$LL.chat.brick.computer.machine({ name })}</span>
                        <span class="bp-mid"
                            >{job?.status === "waiting"
                                ? $LL.chat.brick.computer.waitingForYou()
                                : working
                                ? $LL.chat.brick.computer.working()
                                : $LL.chat.brick.computer.resting()}</span
                        >
                        <span class="bp-cn"
                            >{working
                                ? job?.title
                                    ? `${job.title} · ${stepLine}`
                                    : stepLine
                                : $LL.chat.brick.computer.restingLine()}</span
                        >
                    </div>
                    {#if working}
                        <PageButton tall disabled={busy} testId="brickComputerStop" on:click={() => act("stop")}
                            >{$LL.chat.brick.computer.stop()}</PageButton
                        >
                        {#if canWatch(view)}
                            <PageButton tall go testId="brickComputerWatch" on:click={() => openBrickScreen(brick)}
                                >{job?.status === "waiting"
                                    ? $LL.chat.brick.computer.takeOver()
                                    : $LL.chat.brick.computer.watch()}</PageButton
                            >
                        {/if}
                    {/if}
                </div>

                {#if month}
                    <div class="bp-cap gap">{$LL.chat.brick.computer.month()}</div>
                    <div class="meter" role="img" aria-label={monthText}>
                        <span style="width:{Math.round(month.leftFraction * 100)}%" />
                    </div>
                    <svelte:element
                        this={onUsage ? "button" : "div"}
                        class="vg-tap"
                        type={onUsage ? "button" : undefined}
                        role={onUsage ? "button" : undefined}
                        data-testid="brickComputerMonth"
                        on:click={onUsage}
                    >
                        <span class="bp-mtx"
                            ><span class="vg-t">{monthText}</span><span class="bp-cn"
                                >{monthDay
                                    ? $LL.chat.brick.computer.monthLine({ day: monthDay })
                                    : $LL.chat.brick.computer.monthLineNoDay()}</span
                            ></span
                        >
                        {#if onUsage}
                            <span class="vg-chg">{$LL.chat.brick.computer.usage()}</span>
                            <IconChevronRight font-size="18" />
                        {/if}
                    </svelte:element>
                {/if}

                <div class="vg-tap">
                    <span class="vg-ico"><IconFolder font-size="20" /></span>
                    <span class="bp-mtx"
                        ><span class="vg-t">{$LL.chat.brick.computer.itsFiles()}</span><span class="bp-cn"
                            >{filesLine}</span
                        ></span
                    >
                </div>
                <div class="vg-tap">
                    <span class="vg-ico"><IconEye font-size="20" /></span>
                    <span class="bp-mtx"
                        ><span class="vg-t">{$LL.chat.brick.computer.watchAndTakeOver()}</span><span class="bp-cn"
                            >{$LL.chat.brick.computer.watchAndTakeOverLine()}</span
                        ></span
                    >
                </div>

                <div class="off">
                    <PageButton tall disabled={busy} testId="brickComputerOff" on:click={() => act("turn-off")}
                        >{$LL.chat.brick.computer.turnOff()}</PageButton
                    >
                    <span class="bp-cn">{$LL.chat.brick.computer.turnOffLine({ name })}</span>
                </div>
            {/if}
        </div>
    </PageGroup>
{/if}

<style>
    .cg {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 2px 4px 12px;
        color: #fff;
    }
    .lead {
        margin: 0 4px 6px;
        font-size: 14px;
        line-height: 1.45;
        color: rgba(244, 242, 250, 0.86);
    }
    /* From here down: the Voice group's own values. */
    .bp-cap {
        padding: 0 4px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(244, 242, 250, 0.64);
    }
    .bp-cap.gap {
        margin-top: 10px;
    }
    .bp-model .bp-cap {
        padding: 0;
    }
    .vg-tap {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        min-height: 56px;
        margin: 0;
        padding: 6px 4px 6px 8px;
        border: 0;
        border-radius: 14px;
        background: transparent;
        color: #fff;
        font: inherit;
        text-align: start;
    }
    .vg-tap > :global(svg) {
        flex: none;
        color: rgba(244, 242, 250, 0.64);
    }
    .vg-ico {
        display: grid;
        place-items: center;
        flex: none;
        width: 32px;
        height: 32px;
        color: #fff;
    }
    .vg-t {
        font-size: 14px;
        font-weight: 600;
    }
    .vg-chg {
        flex: none;
        font-size: 14px;
        font-weight: 600;
        color: #c4b5fd;
    }
    .bp-mtx {
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
    }
    .bp-mid {
        font-size: 15px;
        font-weight: 700;
    }
    .bp-cn {
        font-size: 12.5px;
        line-height: 1.35;
        color: rgba(244, 242, 250, 0.64);
    }
    .bp-model {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px;
        border-radius: 14px;
        background: #0a0814;
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
    }
    .vg-go {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 48px;
        margin: 6px 0 4px;
        border: 0;
        border-radius: 999px;
        background: linear-gradient(135deg, #8629fc, #4156f6);
        font: inherit;
        font-size: 15px;
        font-weight: 700;
        color: #fff;
    }
    .bp-note {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        margin: 0;
        padding: 0 4px;
        font-size: 12.5px;
        line-height: 1.35;
        color: rgba(244, 242, 250, 0.64);
    }
    .bp-note :global(svg) {
        flex: none;
        margin-top: 1px;
    }
    /* The Usage page's own bar. */
    .meter {
        height: 8px;
        margin: 4px 8px 0;
        border-radius: 999px;
        background: rgb(255 255 255 / 0.12);
        overflow: hidden;
    }
    .meter span {
        display: block;
        height: 100%;
        border-radius: 999px;
        background: linear-gradient(135deg, #8629fc, #4156f6);
    }
    .off {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 6px;
        margin-top: 8px;
        padding: 10px 4px 0;
        border-top: 1px solid rgb(255 255 255 / 0.06);
    }
</style>
