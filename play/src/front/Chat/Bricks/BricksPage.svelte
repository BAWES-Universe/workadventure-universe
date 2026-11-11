<script lang="ts">
    import { onMount } from "svelte";
    import { openModal } from "svelte-modals";
    import LL, { locale } from "../../../i18n/i18n-svelte";
    import PanelHeader from "../../Components/MapEditor/EditMode/PanelHeader.svelte";
    import PageSwitch from "../../external-modules/bots/components/page/PageSwitch.svelte";
    import { warningMessageStore } from "../../Stores/ErrorStore";
    import { bricksPageOpenStore } from "../Stores/ChatStore";
    import PageButton from "../../external-modules/bots/components/page/PageButton.svelte";
    import { shortDay, type BrickCard, type DeletedBrickCard } from "./Brick";
    import { openBrickChat, openingBrickChats } from "./BrickChat";
    import BrickPage from "./BrickPage.svelte";
    import BrickPicture from "./BrickPicture.svelte";
    import {
        loadMyBricks,
        myBricksSettled,
        myBricksStore,
        myDeletedBricksStore,
        setMyBrickEnabled,
        undoMyBrick,
    } from "./MyBricksStore";
    import NewBrickDialog from "./NewBrickDialog.svelte";
    import { IconChevronDown, IconDots, IconLoader, IconPlus } from "@wa-icons";

    /**
     * The Bricks page (game #1995): the person's own Bricks, each with its switch. The Bricks button in the Chats footer
     * opens it over the chat list, the way "Find a group" opens. A tap on a Brick opens its chat. New Brick on top makes
     * another one (#1996); the dots on a row open that Brick's own page, where it can be deleted; a deleted Brick waits
     * under Deleted with Undo until the day it is gone for good. Goals and tasks, apps and usage come to this page with
     * their own issues.
     *
     * Drawn like the bots list of the map editor (BotList and BotRow): the same header, sections, rows and switch.
     */
    type Section = "active" | "inactive";

    let loading = false;
    // Where each Brick is listed, fixed when it first shows: switching one does not move it from under the finger. It
    // is in the right section the next time the page opens.
    let placement = new Map<string, Section>();
    let switching = new Set<string>();
    let collapsed: Record<Section, boolean> = { active: false, inactive: false };
    // The Brick whose own page is open over the list
    let pageOfId: string | undefined;
    let undoing = new Set<string>();

    $: list = $LL.mapEditor.edit.bots.page.list;
    $: bricks = $myBricksStore;
    $: {
        const next = new Map<string, Section>();
        for (const brick of bricks ?? []) {
            next.set(brick.id, placement.get(brick.id) ?? (brick.enabled ? "active" : "inactive"));
        }
        placement = next;
    }
    $: sections = (["active", "inactive"] as const).map((key) => ({
        key,
        title: key === "active" ? list.active() : list.inactive(),
        bricks: (bricks ?? []).filter((brick) => placement.get(brick.id) === key),
    }));

    $: pageOf = pageOfId ? (bricks ?? []).find((brick) => brick.id === pageOfId) : undefined;
    $: deletedBricks = $myDeletedBricksStore;

    async function onUndo(brick: DeletedBrickCard) {
        undoing = new Set([...undoing, brick.id]);
        const back = await undoMyBrick(brick.id);
        undoing = new Set([...undoing].filter((id) => id !== brick.id));
        if (!back) warningMessageStore.addWarningMessage($LL.chat.brick.undoFailed());
    }

    function close() {
        bricksPageOpenStore.set(false);
    }

    function load() {
        loading = true;
        loadMyBricks()
            .catch((error) => console.error(error))
            .finally(() => (loading = false));
    }

    async function onSwitch(brick: BrickCard, enabled: boolean) {
        switching = new Set([...switching, brick.id]);
        const saved = await setMyBrickEnabled(brick.id, enabled);
        switching = new Set([...switching].filter((id) => id !== brick.id));
        if (!saved) warningMessageStore.addWarningMessage($LL.chat.brick.switchFailed());
    }

    function open(brick: BrickCard) {
        openBrickChat(brick.id).catch((error) => console.error(error));
    }

    function onRowKey(event: KeyboardEvent, brick: BrickCard) {
        // Only the row itself: Space on the switch inside it switches, and opens nothing.
        if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        open(brick);
    }

    // Read again each time the page opens: a Brick made or switched on another device shows.
    onMount(load);
</script>

{#if pageOf}
    <BrickPage brick={pageOf} onBack={() => (pageOfId = undefined)} onDeleted={() => (pageOfId = undefined)} />
{:else}
    <div class="bk flex h-full min-h-0 flex-col" data-testid="bricksPage">
        <PanelHeader
            title={$LL.chat.brick.bricks()}
            onBack={close}
            backLabel={$LL.chat.brick.backToChats()}
            canHide={false}
        />
        {#if bricks === undefined}
            {#if loading || !$myBricksSettled}
                <p class="bk-note" data-testid="bricksLoading">{$LL.chat.brick.loading()}</p>
            {:else}
                <p class="bk-note bk-bad" data-testid="bricksLoadFailed">{$LL.chat.brick.loadFailed()}</p>
                <button type="button" class="bk-pill" data-testid="bricksTryAgain" on:click={load}>
                    {$LL.chat.brick.tryAgain()}
                </button>
            {/if}
        {:else}
            <button type="button" class="bk-new" data-testid="bricksNew" on:click={() => openModal(NewBrickDialog)}>
                <IconPlus font-size="20" />{$LL.chat.brick.newBrick()}
            </button>
            {#if bricks.length === 0 && deletedBricks.length === 0}
                <p class="bk-note" data-testid="bricksNone">{$LL.chat.brick.none()}</p>
            {/if}
            <div class="bk-scroll">
                {#each sections as section (section.key)}
                    {#if section.bricks.length > 0}
                        <button
                            type="button"
                            class="bk-sec"
                            aria-expanded={!collapsed[section.key]}
                            on:click={() => (collapsed = { ...collapsed, [section.key]: !collapsed[section.key] })}
                        >
                            <span>{section.title} · {section.bricks.length}</span>
                            <span class="bk-chev" class:closed={collapsed[section.key]}
                                ><IconChevronDown font-size="16" /></span
                            >
                        </button>
                        {#if !collapsed[section.key]}
                            {#each section.bricks as brick (brick.id)}
                                <div
                                    class="bk-row"
                                    class:off={!brick.enabled}
                                    role="button"
                                    tabindex="0"
                                    aria-label={$LL.chat.brick.openChat({ name: brick.name })}
                                    aria-busy={$openingBrickChats.has(brick.id)}
                                    data-testid="bricksRow"
                                    on:click={() => open(brick)}
                                    on:keydown={(event) => onRowKey(event, brick)}
                                >
                                    <span class="bk-pic"><BrickPicture look={brick.characterTextureId} /></span>
                                    <span class="bk-tx">
                                        <span class="bk-t">{brick.name}</span>
                                        {#if brick.description}
                                            <span class="bk-m">{brick.description}</span>
                                        {/if}
                                    </span>
                                    {#if $openingBrickChats.has(brick.id)}
                                        <span class="bk-busy" data-testid="bricksRowOpening">
                                            <IconLoader class="animate-[spin_2s_linear_infinite]" font-size="18" />
                                        </span>
                                    {/if}
                                    <button
                                        type="button"
                                        class="bk-more"
                                        aria-label={$LL.chat.brick.more({ name: brick.name })}
                                        data-testid="bricksRowMore"
                                        on:click|stopPropagation={() => (pageOfId = brick.id)}
                                        on:keydown|stopPropagation
                                    >
                                        <IconDots font-size="20" />
                                    </button>
                                    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
                                    <span class="bk-sw" on:click|stopPropagation>
                                        <PageSwitch
                                            checked={brick.enabled}
                                            label={$LL.chat.brick.switchOn({ name: brick.name })}
                                            disabled={switching.has(brick.id)}
                                            testId="bricksRowSwitch"
                                            onChange={(enabled) => {
                                                onSwitch(brick, enabled).catch((error) => console.error(error));
                                            }}
                                        />
                                    </span>
                                </div>
                            {/each}
                        {/if}
                    {/if}
                {/each}
                {#if deletedBricks.length > 0}
                    <div class="bk-sec bk-sec-plain" data-testid="bricksDeletedTitle">
                        <span>{$LL.chat.brick.deleted()} · {deletedBricks.length}</span>
                    </div>
                    {#each deletedBricks as brick (brick.id)}
                        <div class="bk-row bk-gone off" data-testid="bricksDeletedRow">
                            <span class="bk-pic"><BrickPicture look={brick.characterTextureId} /></span>
                            <span class="bk-tx">
                                <span class="bk-t">{brick.name}</span>
                                <span class="bk-m"
                                    >{$LL.chat.brick.goneOn({ day: shortDay(brick.goneAt, $locale) })}</span
                                >
                            </span>
                            <PageButton
                                tall
                                disabled={undoing.has(brick.id)}
                                testId="bricksUndo"
                                on:click={() => {
                                    onUndo(brick).catch((error) => console.error(error));
                                }}>{$LL.chat.brick.undo()}</PageButton
                            >
                        </div>
                    {/each}
                {/if}
            </div>
        {/if}
    </div>
{/if}

<style>
    /* The page sits in the chat's list column: the header's own inset, then the list. */
    .bk {
        gap: 10px;
        padding: 12px 14px 14px;
        color: #fff;
    }
    .bk-scroll {
        display: flex;
        flex-direction: column;
        gap: 2px;
        flex: 1;
        min-height: 0;
        overflow-y: auto;
    }
    .bk-sec {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        min-height: 44px;
        margin: 4px 0 0;
        padding: 0 8px;
        border: 0;
        background: transparent;
        font: inherit;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(244, 242, 250, 0.5);
        cursor: pointer;
    }
    .bk-sec:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: -2px;
    }
    .bk-chev {
        display: grid;
        place-items: center;
        transition: transform 0.15s;
    }
    .bk-chev.closed {
        transform: rotate(-90deg);
    }
    :global([dir="rtl"]) .bk-chev.closed {
        transform: rotate(90deg);
    }
    .bk-row {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 56px;
        padding: 6px 8px;
        border-radius: 14px;
        color: #fff;
        cursor: pointer;
    }
    @media (hover: hover) {
        .bk-row:hover {
            background: rgba(255, 255, 255, 0.05);
        }
    }
    .bk-row:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: -2px;
    }
    .bk-pic {
        display: grid;
        place-items: center;
        flex: none;
        width: 44px;
        height: 44px;
        border-radius: 50%;
        background: radial-gradient(
            circle at 50% 42%,
            rgba(134, 41, 252, 0.35),
            rgba(65, 86, 246, 0.12) 58%,
            rgba(255, 255, 255, 0.03) 72%
        );
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.28);
    }
    .bk-new {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        flex: none;
        width: 100%;
        height: 44px;
        margin: 0;
        padding: 0 16px;
        border: 0;
        border-radius: 999px;
        background: linear-gradient(90deg, #8629fc, #4156f6);
        box-shadow: 0 8px 24px -10px rgba(134, 41, 252, 0.8);
        font: inherit;
        font-size: 14px;
        font-weight: 700;
        color: #fff;
        cursor: pointer;
    }
    .bk-new:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 2px;
    }
    .bk-sec-plain {
        cursor: default;
    }
    .bk-gone {
        cursor: default;
    }
    @media (hover: hover) {
        .bk-row.bk-gone:hover {
            background: transparent;
        }
    }
    .bk-more {
        display: grid;
        place-items: center;
        flex: none;
        width: 44px;
        height: 44px;
        margin: 0;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: transparent;
        color: rgba(244, 242, 250, 0.64);
        cursor: pointer;
    }
    @media (hover: hover) {
        .bk-more:hover {
            background: rgba(255, 255, 255, 0.08);
            color: #fff;
        }
    }
    .bk-more:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: -2px;
    }
    .off .bk-pic {
        filter: grayscale(1);
        opacity: 0.6;
    }
    .bk-tx {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 0;
    }
    .bk-t {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 14px;
        font-weight: 600;
    }
    .off .bk-t {
        color: rgba(244, 242, 250, 0.7);
    }
    .bk-m {
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        overflow: hidden;
        font-size: 12.5px;
        line-height: 1.3;
        color: rgba(244, 242, 250, 0.64);
    }
    .bk-busy {
        display: grid;
        place-items: center;
        flex: none;
        color: rgba(244, 242, 250, 0.6);
    }
    .bk-sw {
        display: grid;
        place-items: center;
        flex: none;
    }
    .bk-note {
        margin: 0;
        padding: 0 8px;
        font-size: 13px;
        line-height: 1.4;
        color: rgba(244, 242, 250, 0.64);
    }
    .bk-bad {
        color: #ff8a7a;
    }
    .bk-pill {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        align-self: flex-start;
        height: 44px;
        margin: 0 8px;
        padding: 0 18px;
        border: 0;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        color: #fff;
        cursor: pointer;
    }
    .bk-pill:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 2px;
    }
</style>
