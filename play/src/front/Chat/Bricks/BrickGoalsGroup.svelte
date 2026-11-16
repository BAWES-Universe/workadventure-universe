<script lang="ts">
    import { onMount } from "svelte";
    import LL, { locale } from "../../../i18n/i18n-svelte";
    import type { TranslationFunctions } from "../../../i18n/i18n-types";
    import PageButton from "../../external-modules/bots/components/page/PageButton.svelte";
    import PageGroup from "../../external-modules/bots/components/page/PageGroup.svelte";
    import { warningMessageStore } from "../../Stores/ErrorStore";
    import { openBrickChat } from "./BrickChat";
    import {
        brickGoalsList,
        groupGoalItems,
        sayBrief,
        sayDone,
        sayStatus,
        sayWhen,
        type GoalItem,
        type GoalTap,
    } from "./BrickGoals";
    import {
        IconBell,
        IconCalendarRepeat,
        IconChevronRight,
        IconCircleCheck,
        IconHistory,
        IconRadar,
        IconSparkles,
        IconTargetArrow,
    } from "@wa-icons";
    import "./BrickGroups.css";

    /**
     * Goals and tasks on a Brick's page (game #2002): what this Brick keeps for its owner, in three plain parts the way
     * a person's profile has them: In progress, Scheduled and Done. A goal is said in chat; here the person sees it,
     * changes it (in the chat, in their own words: there is no form), pauses it or closes it. Buttons say what they
     * do. Only the owner's own list: Orbit shows it to nobody else.
     */
    export let botId: string;
    export let name: string;
    export let open = false;
    export let onToggle: (id: string) => void;
    /** Opens "Everything Brick did"; without it the row is not shown. */
    export let onOpenDid: (() => void) | undefined = undefined;

    /** The first Done rows before "See all": a person who has finished many does not scroll past them. */
    const FIRST_DONE = 5;

    const list = brickGoalsList(botId);
    const { items, state } = list;
    let allDone = false;
    // The rows a tap is in flight for, so a second tap on the same row does nothing more
    let busy = new Set<string>();

    $: parts = groupGoalItems($items);
    $: shownDone = allDone ? parts.done : parts.done.slice(0, FIRST_DONE);
    $: brief = $state === "ready" ? sayBrief($items, Date.now(), $LL, $locale) : "";

    onMount(() => {
        list.load().catch((error) => console.error(error));
    });

    function tap(item: GoalItem, action: GoalTap) {
        if (busy.has(item.id)) return;
        busy = new Set([...busy, item.id]);
        list.tap(item.id, action)
            .then((result) => {
                if (result === "refused") warningMessageStore.addWarningMessage($LL.chat.brick.goals.tapFailed());
                else if (result === "stale") warningMessageStore.addWarningMessage($LL.chat.brick.goals.tapStale());
            })
            .catch((error) => console.error(error))
            .finally(() => {
                busy = new Set([...busy].filter((id) => id !== item.id));
            });
    }

    function openChat() {
        openBrickChat(botId).catch((error) => console.error(error));
    }

    /** "Change" opens this Brick's chat with the goal named: the Brick asks what to change, and the person says it. */
    function change(item: GoalItem) {
        openBrickChat(botId)
            .then((room) => room?.sendMessage($LL.chat.brick.goals.changeAsk({ words: item.words })))
            .catch((error) => console.error(error));
    }

    const stepClass = (step: string) => (step === "done" ? "done" : step === "doing" ? "now" : "todo");
    // $LL and $locale are passed in from the markup, so a change of language redraws these lines
    const by = (item: GoalItem, ll: TranslationFunctions) =>
        item.setBy === "brick" ? ll.chat.brick.goals.byBrick({ name }) : ll.chat.brick.goals.byYou();
    const sub = (item: GoalItem, ll: TranslationFunctions, lang: string) =>
        [item.state === "paused" ? ll.chat.brick.goals.paused() : "", sayWhen(item, Date.now(), ll, lang), by(item, ll)]
            .filter((bit) => bit !== "")
            .join(" · ");
</script>

<PageGroup id="goals" icon={IconTargetArrow} title={$LL.chat.brick.goals.title()} {brief} {open} {onToggle}>
    <div class="bkg" data-testid="brickGoals">
        {#if $state === "failed"}
            <div class="bkg-retry">
                <p class="bkg-lead">{$LL.chat.brick.goals.loadFailed({ name })}</p>
                <PageButton testId="goalsRetry" on:click={() => list.load()}>{$LL.chat.brick.goals.retry()}</PageButton>
            </div>
        {:else if $state === "ready" && $items.length === 0}
            <p class="bkg-lead" data-testid="goalsEmpty">{$LL.chat.brick.goals.lead({ name })}</p>
            <div class="bkg-cap">{$LL.chat.brick.goals.forTitle()}</div>
            <div class="bkg-tap">
                <span class="bkg-ico"><IconTargetArrow font-size="20" /></span>
                <span class="bkg-mtx"
                    ><span class="bkg-t">{$LL.chat.brick.goals.goalTitle()}</span><span class="bkg-cn"
                        >{$LL.chat.brick.goals.goalExample()}</span
                    ></span
                >
            </div>
            <div class="bkg-tap">
                <span class="bkg-ico"><IconRadar font-size="20" /></span>
                <span class="bkg-mtx"
                    ><span class="bkg-t">{$LL.chat.brick.goals.watchTitle()}</span><span class="bkg-cn"
                        >{$LL.chat.brick.goals.watchExample()}</span
                    ></span
                >
            </div>
            <div class="bkg-tap">
                <span class="bkg-ico"><IconCalendarRepeat font-size="20" /></span>
                <span class="bkg-mtx"
                    ><span class="bkg-t">{$LL.chat.brick.goals.scheduleTitle()}</span><span class="bkg-cn"
                        >{$LL.chat.brick.goals.scheduleExample()}</span
                    ></span
                >
            </div>
            <div class="bkg-tap">
                <span class="bkg-ico"><IconBell font-size="20" /></span>
                <span class="bkg-mtx"
                    ><span class="bkg-t">{$LL.chat.brick.goals.reminderTitle()}</span><span class="bkg-cn"
                        >{$LL.chat.brick.goals.reminderExample()}</span
                    ></span
                >
            </div>
            <button type="button" class="bkg-go-btn" data-testid="goalsGive" on:click={openChat}
                >{$LL.chat.brick.goals.giveGoal({ name })}</button
            >
            <p class="bkg-note">
                <IconSparkles font-size="14" /><span>{$LL.chat.brick.goals.giveNote({ name })}</span>
            </p>
        {:else if $state === "ready"}
            {#if parts.progress.length > 0}
                <div class="bkg-cap">{$LL.chat.brick.goals.inProgress()}</div>
                {#each parts.progress as item (item.id)}
                    <div class="goal" data-testid="goalCard">
                        <div class="bkg-mtx">
                            <span class="bkg-cap">{$LL.chat.brick.goals.yourGoal()}</span>
                            <span class="mid" data-testid="goalWords">{item.words}</span>
                            <span class="bkg-cn" data-testid="goalStatus">{sayStatus(item, $LL)}</span>
                        </div>
                        {#if item.asking}
                            <p class="ask" role="status" data-testid="goalAsk">
                                {item.asking === "unsure"
                                    ? $LL.chat.brick.goals.askUnsure({ name })
                                    : $LL.chat.brick.goals.askDatePassed()}
                            </p>
                        {/if}
                        {#if item.steps.length > 0}
                            <ul>
                                {#each item.steps as step, index (index)}
                                    <li class={stepClass(step.state)} data-testid="goalStep">
                                        <span class="dot">{step.state === "done" ? "✓" : ""}</span>{step.text}
                                    </li>
                                {/each}
                            </ul>
                        {/if}
                        <div class="row">
                            {#if item.asking}
                                <PageButton
                                    disabled={busy.has(item.id)}
                                    testId="goalKeep"
                                    on:click={() => tap(item, "keep")}>{$LL.chat.brick.goals.keepGoing()}</PageButton
                                >
                            {/if}
                            <PageButton testId="goalChange" on:click={() => change(item)}
                                >{$LL.chat.brick.goals.change()}</PageButton
                            >
                            <PageButton
                                disabled={busy.has(item.id)}
                                testId={item.state === "paused" ? "goalResume" : "goalPause"}
                                on:click={() => tap(item, item.state === "paused" ? "resume" : "pause")}
                                >{item.state === "paused"
                                    ? $LL.chat.brick.goals.resume()
                                    : $LL.chat.brick.goals.pause()}</PageButton
                            >
                            <PageButton
                                disabled={busy.has(item.id)}
                                testId="goalDone"
                                on:click={() => tap(item, "done")}>{$LL.chat.brick.goals.markDone()}</PageButton
                            >
                        </div>
                    </div>
                {/each}
            {/if}
            {#if parts.scheduled.length > 0}
                <div class="bkg-cap gap">{$LL.chat.brick.goals.scheduled()}</div>
                {#each parts.scheduled as item (item.id)}
                    <div class="bkg-tap" data-testid="goalScheduled">
                        <span class="bkg-ico">
                            {#if item.kind === "reminder"}<IconBell font-size="20" />
                            {:else if item.kind === "watch"}<IconRadar font-size="20" />
                            {:else}<IconCalendarRepeat font-size="20" />{/if}
                        </span>
                        <span class="bkg-mtx"
                            ><span class="bkg-t">{item.words}</span><span class="bkg-cn">{sub(item, $LL, $locale)}</span
                            ></span
                        >
                        {#if item.state === "paused" && item.goalId !== null && $items.some((one) => one.id === item.goalId && one.state === "paused")}
                            <!-- Paused with its goal: only the goal's own Resume brings it back, so no button of its own -->
                        {:else if item.state === "paused"}
                            <PageButton
                                disabled={busy.has(item.id)}
                                testId="goalResume"
                                on:click={() => tap(item, "resume")}>{$LL.chat.brick.goals.resume()}</PageButton
                            >
                        {:else if item.kind === "reminder" && item.cadence.type === "once"}
                            <PageButton
                                disabled={busy.has(item.id)}
                                testId="goalSnooze"
                                on:click={() => tap(item, "snooze")}>{$LL.chat.brick.goals.snooze()}</PageButton
                            >
                        {:else}
                            <PageButton
                                disabled={busy.has(item.id)}
                                testId="goalPause"
                                on:click={() => tap(item, "pause")}>{$LL.chat.brick.goals.pause()}</PageButton
                            >
                        {/if}
                    </div>
                {/each}
            {/if}
            {#if parts.done.length > 0}
                <div class="bkg-cap gap">{$LL.chat.brick.goals.done()}</div>
                {#each shownDone as item (item.id)}
                    <div class="bkg-tap" data-testid="goalDoneRow">
                        <span class="bkg-ico ok"><IconCircleCheck font-size="20" /></span>
                        <span class="bkg-mtx"
                            ><span class="bkg-t">{item.words}</span><span class="bkg-cn"
                                >{sayDone(item, $LL, $locale)}</span
                            ></span
                        >
                        <PageButton
                            disabled={busy.has(item.id)}
                            testId="goalReopen"
                            on:click={() => tap(item, "reopen")}>{$LL.chat.brick.goals.reopen()}</PageButton
                        >
                    </div>
                {/each}
                {#if !allDone && parts.done.length > FIRST_DONE}
                    <button type="button" class="bkg-tap" data-testid="goalsSeeAll" on:click={() => (allDone = true)}>
                        <span class="bkg-mtx"
                            ><span class="bkg-t">{$LL.chat.brick.goals.seeAll({ count: parts.done.length })}</span
                            ></span
                        >
                    </button>
                {/if}
            {/if}
            {#if onOpenDid && $items.length > 0}
                <!-- Under Done, as in the mock: shown whenever it has anything, since a failed run shows there at once -->
                <button type="button" class="bkg-tap" data-testid="goalsDidRow" on:click={onOpenDid}>
                    <span class="bkg-ico"><IconHistory font-size="20" /></span>
                    <span class="bkg-mtx"
                        ><span class="bkg-t">{$LL.chat.brick.goals.didRow({ name })}</span><span class="bkg-cn"
                            >{$LL.chat.brick.goals.didRowNote()}</span
                        ></span
                    >
                    <IconChevronRight class="bkg-go" font-size="18" />
                </button>
            {/if}
            <div class="bkg-off">
                <PageButton tall testId="goalsNew" on:click={openChat}
                    >{$LL.chat.brick.goals.giveMore({ name })}</PageButton
                >
                <span class="bkg-cn">{$LL.chat.brick.goals.giveMoreNote()}</span>
            </div>
        {/if}
    </div>
</PageGroup>

<style>
    .goal {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 12px;
        border-radius: 14px;
        background: #0a0814;
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
    }
    .goal :global(.bkg-cap) {
        padding: 0;
    }
    .mid {
        overflow-wrap: anywhere;
        font-size: 16px;
        font-weight: 700;
    }
    .ask {
        margin: 0;
        padding: 8px 10px;
        border-radius: 10px;
        background: rgb(134 41 252 / 0.16);
        font-size: 13.5px;
        line-height: 1.4;
        color: #fff;
    }
    ul {
        display: flex;
        flex-direction: column;
        gap: 7px;
        margin: 0;
        padding: 0;
        list-style: none;
    }
    li {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 13.5px;
        color: rgba(244, 242, 250, 0.64);
    }
    li.done {
        color: rgba(244, 242, 250, 0.86);
    }
    li.now {
        color: #fff;
        font-weight: 600;
    }
    .dot {
        display: grid;
        place-items: center;
        flex: none;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        box-shadow: inset 0 0 0 1.5px rgba(244, 242, 250, 0.4);
        font-size: 11px;
        font-weight: 700;
    }
    li.done .dot {
        background: rgba(255, 255, 255, 0.16);
        box-shadow: none;
        color: #fff;
    }
    li.now .dot {
        background: linear-gradient(135deg, #8629fc, #4156f6);
        box-shadow: 0 0 0 3px rgb(134 41 252 / 0.25);
    }
    .row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
    }
    .bkg :global(.bkg-ico.ok) {
        color: #6ee7a8;
    }
</style>
