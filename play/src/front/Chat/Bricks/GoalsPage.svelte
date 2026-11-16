<script lang="ts">
    import { onMount } from "svelte";
    import LL, { locale } from "../../../i18n/i18n-svelte";
    import type { TranslationFunctions } from "../../../i18n/i18n-types";
    import PanelHeader from "../../Components/MapEditor/EditMode/PanelHeader.svelte";
    import PageButton from "../../external-modules/bots/components/page/PageButton.svelte";
    import { warningMessageStore } from "../../Stores/ErrorStore";
    import {
        groupGoalItems,
        myGoalsList,
        sayDone,
        sayStatus,
        sayWhen,
        type GoalItem,
        type GoalTap,
    } from "./BrickGoals";
    import BrickPicture from "./BrickPicture.svelte";
    import { IconChevronRight } from "@wa-icons";
    import "./BrickGroups.css";

    /**
     * Goals and tasks across all of the person's Bricks (game #2002, mock t-7-all), opened from its row on the Bricks
     * page or from "Goals and tasks" in a Brick's words. The same three parts as on a Brick's page, each row with its
     * Brick's face and name. Pause, Resume and Snooze work here; a tap on a row opens it on its Brick's page, where
     * Change, Mark done and Reopen are. Nothing is added here: a person tells any Brick in its chat.
     */
    export let onBack: () => void;
    /** Opens a Brick's own page, on its Goals and tasks. */
    export let onOpen: (brickId: string) => void;
    /** Each Brick's look and name, from the Bricks page's own list. */
    export let looks: Record<string, string | null> = {};
    export let names: Record<string, string> = {};

    /** The first Done rows before "See all", as on a Brick's page. */
    const FIRST_DONE = 5;

    const { items, state } = myGoalsList;
    let allDone = false;
    // The rows a tap is in flight for, so a second tap on the same row does nothing more
    let busy = new Set<string>();

    $: parts = groupGoalItems($items);
    $: shownDone = allDone ? parts.done : parts.done.slice(0, FIRST_DONE);

    // Read again each time the page opens: what shows from the Bricks page stays while it is read
    onMount(() => {
        myGoalsList.load().catch((error) => console.error(error));
    });

    function tap(item: GoalItem, action: GoalTap) {
        if (busy.has(item.id)) return;
        busy = new Set([...busy, item.id]);
        myGoalsList
            .tap(item.id, action)
            .then((result) => {
                if (result === "refused") warningMessageStore.addWarningMessage($LL.chat.brick.goals.tapFailed());
                else if (result === "stale") warningMessageStore.addWarningMessage($LL.chat.brick.goals.tapStale());
            })
            .catch((error) => console.error(error))
            .finally(() => {
                busy = new Set([...busy].filter((id) => id !== item.id));
            });
    }

    function onRowKey(event: KeyboardEvent, item: GoalItem) {
        // Only the row itself: Enter on its button is the button's
        if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        onOpen(item.brickId);
    }

    const nameOf = (item: GoalItem) => item.brickName || names[item.brickId] || "";
    // $LL and $locale are passed in from the markup, so a change of language redraws these lines
    const line = (item: GoalItem, ll: TranslationFunctions, lang: string) => {
        const said =
            item.group === "done"
                ? [sayDone(item, ll, lang)]
                : item.group === "progress"
                ? [sayStatus(item, ll)]
                : [item.state === "paused" ? ll.chat.brick.goals.paused() : "", sayWhen(item, Date.now(), ll, lang)];
        return [nameOf(item), ...said].filter((bit) => bit !== "").join(" · ");
    };
    // A check paused with its goal: only the goal's own Resume (on its Brick's page) brings it back
    const pausedWithGoal = (item: GoalItem, all: GoalItem[]) =>
        item.state === "paused" &&
        item.goalId !== null &&
        all.some((one) => one.id === item.goalId && one.state === "paused");
</script>

<div class="gp flex h-full min-h-0 flex-col" data-testid="goalsPage">
    <PanelHeader
        title={$LL.chat.brick.goals.title()}
        {onBack}
        backLabel={$LL.chat.brick.backToBricks()}
        canHide={false}
    />
    <div class="body bkg">
        {#if $state === "failed"}
            <div class="bkg-retry">
                <p class="bkg-lead" data-testid="goalsPageFailed">{$LL.chat.brick.goals.pageLoadFailed()}</p>
                <PageButton testId="goalsPageRetry" on:click={() => myGoalsList.load()}
                    >{$LL.chat.brick.goals.retry()}</PageButton
                >
            </div>
        {:else if $state === "ready" && $items.length === 0}
            <p class="bkg-lead" data-testid="goalsPageNone">{$LL.chat.brick.goals.pageNone()}</p>
        {:else if $state === "ready"}
            {#each [{ key: "progress", title: $LL.chat.brick.goals.inProgress(), rows: parts.progress }, { key: "scheduled", title: $LL.chat.brick.goals.scheduled(), rows: parts.scheduled }, { key: "done", title: $LL.chat.brick.goals.done(), rows: shownDone }] as part (part.key)}
                {#if part.rows.length > 0}
                    <div class="bkg-cap sec">{part.title}</div>
                    {#each part.rows as item (item.id)}
                        <div
                            class="bkg-tap row"
                            role="button"
                            tabindex="0"
                            aria-label={$LL.chat.brick.goals.openOnPage({ words: item.words, name: nameOf(item) })}
                            data-testid="goalsPageRow"
                            data-group={item.group}
                            on:click={() => onOpen(item.brickId)}
                            on:keydown={(event) => onRowKey(event, item)}
                        >
                            <span class="face"><BrickPicture look={looks[item.brickId]} /></span>
                            <span class="bkg-mtx"
                                ><span class="bkg-t">{item.words}</span><span class="bkg-cn"
                                    >{line(item, $LL, $locale)}</span
                                ></span
                            >
                            {#if item.group === "scheduled"}
                                {#if pausedWithGoal(item, $items)}
                                    <!-- Paused with its goal: no button of its own -->
                                {:else}
                                    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
                                    <span class="act" on:click|stopPropagation>
                                        {#if item.state === "paused"}
                                            <PageButton
                                                disabled={busy.has(item.id)}
                                                testId="goalsPageResume"
                                                on:click={() => tap(item, "resume")}
                                                >{$LL.chat.brick.goals.resume()}</PageButton
                                            >
                                        {:else if item.kind === "reminder" && item.cadence.type === "once"}
                                            <PageButton
                                                disabled={busy.has(item.id)}
                                                testId="goalsPageSnooze"
                                                on:click={() => tap(item, "snooze")}
                                                >{$LL.chat.brick.goals.snooze()}</PageButton
                                            >
                                        {:else}
                                            <PageButton
                                                disabled={busy.has(item.id)}
                                                testId="goalsPagePause"
                                                on:click={() => tap(item, "pause")}
                                                >{$LL.chat.brick.goals.pause()}</PageButton
                                            >
                                        {/if}
                                    </span>
                                {/if}
                            {:else}
                                <IconChevronRight class="bkg-go" font-size="20" />
                            {/if}
                        </div>
                    {/each}
                    {#if part.key === "done" && !allDone && parts.done.length > FIRST_DONE}
                        <button
                            type="button"
                            class="bkg-tap"
                            data-testid="goalsPageSeeAll"
                            on:click={() => (allDone = true)}
                        >
                            <span class="bkg-mtx"
                                ><span class="bkg-t">{$LL.chat.brick.goals.seeAll({ count: parts.done.length })}</span
                                ></span
                            >
                        </button>
                    {/if}
                {/if}
            {/each}
            <p class="bkg-note note" data-testid="goalsPageNote">{$LL.chat.brick.goals.pageNote()}</p>
        {/if}
    </div>
</div>

<style>
    /* The page sits in the chat's list column, as the Usage page does. */
    .gp {
        box-sizing: border-box;
        gap: 10px;
        padding: 12px 14px 14px;
        color: #fff;
    }
    .body {
        min-height: 0;
        overflow-y: auto;
        padding: 0;
    }
    .sec {
        display: flex;
        align-items: center;
        min-height: 36px;
        margin-top: 10px;
        padding: 0 8px;
    }
    .sec:first-child {
        margin-top: 0;
    }
    .row {
        padding-inline: 8px;
        cursor: pointer;
    }
    @media (hover: hover) {
        .row:hover {
            background: rgba(255, 255, 255, 0.05);
        }
    }
    .row:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: -2px;
    }
    .face {
        display: grid;
        place-items: center;
        flex: none;
        width: 32px;
        height: 32px;
    }
    .act {
        display: grid;
        place-items: center;
        flex: none;
    }
    .note {
        margin-top: 12px;
        padding: 0 8px;
    }
</style>
