<script lang="ts">
    import { afterUpdate, onDestroy, onMount } from "svelte";
    import { get, type Unsubscriber } from "svelte/store";
    import { activeCoWebsiteStore, coWebsites, fullScreenCowebsite } from "../../Stores/CoWebsiteStore";
    import JitsiCowebsiteComponent from "../Cowebsites/JistiCowebsiteComponent.svelte";
    import SimpleCowebsiteComponent from "../Cowebsites/SimpleCowebsiteComponent.svelte";
    import FileViewerCowebsiteComponent from "../Cowebsites/FileViewerCowebsiteComponent.svelte";
    import { JitsiCoWebsite } from "../../WebRtc/CoWebsite/JitsiCoWebsite";
    import { SimpleCoWebsite } from "../../WebRtc/CoWebsite/SimpleCoWebsite";
    import { FileViewerCoWebsite } from "../../WebRtc/CoWebsite/FileViewerCoWebsite";
    import { BBBCoWebsite } from "../../WebRtc/CoWebsite/BBBCoWebsite";
    import BigBlueButtonCowebsiteComponent from "../Cowebsites/BigBlueButtonCowebsiteComponent.svelte";
    import type { CoWebsite } from "../../WebRtc/CoWebsite/CoWebsite";
    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import { emoteMenuStore } from "../../Stores/EmoteStore";
    import { expressTrayStore } from "../../Stores/ExpressStore";
    import { lightboxOpenStore } from "../../Stores/UserInputStore";
    import { closeAllOpenItems, pickedAfterUndoStore } from "../../Stores/ClosedItemsStore";
    import { openHereListOpenStore } from "../../Stores/OpenHereSheetStore";
    import LL from "../../../i18n/i18n-svelte";
    import CoWebsiteTab from "./CoWebsiteTab.svelte";
    import OpenHereItemIcon from "./OpenHereItemIcon.svelte";
    import { describeCoWebsite } from "./describeCoWebsite";
    import { IconChevronLeft, IconChevronRight, IconChevronDown, IconX } from "@wa-icons";

    /** On an upright phone the items sit in a sheet: no tabs there, the row's "N open" chip opens the list as a sheet. */
    export let sheet = false;

    let activeCowebsite: CoWebsite = $coWebsites[0];
    let unsubscribeCowebsitesUpdate: Unsubscriber | undefined;
    let unsubscribePickedAfterUndo: Unsubscriber | undefined;
    $: activeCoWebsiteStore.set(activeCowebsite);

    onMount(() => {
        let previous: Array<CoWebsite> = [];
        unsubscribeCowebsitesUpdate = coWebsites.subscribe((arr) => {
            // The newest item opens picked. Closing another one leaves the picked one where it is.
            const added = arr.filter((coWebsite) => !previous.includes(coWebsite));
            if (added.length > 0) {
                activeCowebsite = added[added.length - 1];
            } else if (!arr.includes(activeCowebsite)) {
                activeCowebsite = arr[arr.length - 1];
            }
            previous = arr;
        });
        // After an undo the item that was picked is picked again, not the last one back.
        unsubscribePickedAfterUndo = pickedAfterUndoStore.subscribe((picked) => {
            if (picked === undefined) return;
            if (get(coWebsites).includes(picked)) activeCowebsite = picked;
            pickedAfterUndoStore.set(undefined);
        });
    });

    const setActiveCowebsite = (coWebsite: CoWebsite) => {
        activeCowebsite = coWebsite;
    };

    onDestroy(() => {
        fullScreenCowebsite.set(false);
        unsubscribeCowebsitesUpdate?.();
        unsubscribePickedAfterUndo?.();
        openHereListOpenStore.set(false);
        activeCoWebsiteStore.set(undefined);
    });

    // An item on its own has its own row (icon, name, its actions), so the strip of tabs would only add a second row
    // above it. With other panels open the tabs come back, so the person can still switch between them.
    $: soleItem = $coWebsites.length === 1;

    let tabsContainer: HTMLElement | undefined;
    let tabsContainerWidth = 0;
    let tabsOverflowing = false;
    let tabsScrollX = 0;
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    $: tabsContainerWidth, $coWebsites, (tabsOverflowing = areTabsOverflowing());
    // The reactive line above measures before the new tab is drawn, so it counts one tab too few when the window keeps
    // its width (it did not before, as the split resized with every change). Measure again once the page is updated.
    afterUpdate(() => {
        const overflowing = areTabsOverflowing();
        if (overflowing !== tabsOverflowing) {
            tabsOverflowing = overflowing;
        }
    });

    function areTabsOverflowing(): boolean {
        if (!tabsContainer) {
            return false;
        }

        return tabsContainer.scrollWidth > tabsContainer.clientWidth;
    }

    function scrollTabsLeft() {
        if (!tabsContainer) {
            return;
        }
        const scrollX = tabsContainer.scrollLeft;
        for (let i = tabsContainer.childNodes.length - 1; i >= 0; i--) {
            const tab = tabsContainer.childNodes[i] as HTMLElement;
            if (tab.offsetLeft < scrollX) {
                tabsContainer.scrollTo({
                    left: tab.offsetLeft,
                    behavior: "smooth",
                });
                break;
            }
        }
    }

    function scrollTabsRight() {
        if (!tabsContainer) {
            return;
        }
        const scrollX = tabsContainer.scrollLeft;
        for (let i = 0; i < tabsContainer.childNodes.length; i++) {
            const tab = tabsContainer.childNodes[i] as HTMLElement;
            if (tab.offsetLeft > scrollX) {
                tabsContainer.scrollTo({
                    left: tab.offsetLeft,
                    behavior: "smooth",
                });
                break;
            }
        }
    }

    function onTabsScroll() {
        tabsScrollX = tabsContainer?.scrollLeft ?? 0;
    }

    // The "N open" list: every open item in one place, so the seventh tab is one tap away.
    let listElement: HTMLElement | undefined;
    let chipElement: HTMLElement | undefined;
    $: listOpen = $openHereListOpenStore;
    $: if ($coWebsites.length < 2) openHereListOpenStore.set(false);

    function pickFromList(coWebsite: CoWebsite) {
        if (activeCowebsite !== coWebsite) analyticsClient.switchCowebsite();
        setActiveCowebsite(coWebsite);
        openHereListOpenStore.set(false);
    }

    function closeFromList(coWebsite: CoWebsite) {
        coWebsites.remove(coWebsite);
        analyticsClient.closeCowebsite();
    }

    function closeAllFromList() {
        openHereListOpenStore.set(false);
        closeAllOpenItems();
    }

    function onWindowPointerDown(event: PointerEvent) {
        if (!listOpen) return;
        const target = event.target as Node | null;
        // The chip, on the strip or in a phone's row, toggles the list itself.
        if (target && (listElement?.contains(target) || (target as Element).closest?.("[data-open-chip]"))) return;
        openHereListOpenStore.set(false);
    }

    // Esc closes the list first, and leaves the window alone, wherever the focus is (capture: before the window's own Esc).
    function onWindowKeyDownCapture(event: KeyboardEvent) {
        if (event.key === "Escape" && listOpen) {
            // The emote picker, the express tray and a picture shown large take their own Esc, as the window leaves it to them.
            if ($emoteMenuStore || $expressTrayStore !== "closed" || $lightboxOpenStore) return;
            event.preventDefault();
            // Nothing else takes this Esc, such as the find bar of a file.
            event.stopPropagation();
            openHereListOpenStore.set(false);
            chipElement?.focus();
        }
    }

    // A click on a page inside the window never reaches this window, but the game loses the focus to it: the list closes
    // too. Switching to another app also blurs the game, with the focus left where it was, and nothing changes.
    function onWindowBlur() {
        if (!listOpen) return;
        setTimeout(() => {
            if (document.hasFocus() && document.activeElement instanceof HTMLIFrameElement) {
                openHereListOpenStore.set(false);
            }
        }, 0);
    }
</script>

<svelte:window
    on:pointerdown={onWindowPointerDown}
    on:keydown|capture={onWindowKeyDownCapture}
    on:blur={onWindowBlur}
/>

<div
    id="cowebsites-container"
    class="w-full h-full relative cowebsite-window"
    class:in-sheet={sheet}
    class:pill-over-header={$fullScreenCowebsite && soleItem}
>
    <div class="h-full w-full flex flex-col">
        <!-- The tabs: pills with the item's icon, its name and a close. Expanded, the pill (expand, close) sits at the top
             right, and the tabs keep clear of it. A phone has no tabs: its row has the chip, and the list is a sheet. -->
        {#if !sheet}
            <div
                class="flex pb-2 pt-2 ms-3 items-center height-tab overflow-hidden flex-none"
                class:hidden={soleItem}
                class:expanded-tabs={$fullScreenCowebsite}
            >
                {#if tabsOverflowing && tabsScrollX > 0}
                    <div class="flex-0 w-10">
                        <button
                            class="w-10 h-10 rounded flex items-center justify-center hover:bg-white/10 me-2"
                            on:click={scrollTabsLeft}
                        >
                            <IconChevronLeft font-size="20" class="text-white" />
                        </button>
                    </div>
                {/if}
                <!-- For some weird reason, we need to put a random width so that flex-1 can work and ignore the width...
                 Otherwise, flex-1 does nothing -->
                <div class="tab-bar flex-1 w-32" bind:clientWidth={tabsContainerWidth}>
                    <div
                        bind:this={tabsContainer}
                        class="flex items-center overflow-x-hidden space-x-2 snap-x touch-pan-x"
                        on:scroll={onTabsScroll}
                    >
                        {#each $coWebsites as coWebsite, index (coWebsite.getId())}
                            <!-- svelte-ignore a11y-click-events-have-key-events -->
                            <!-- svelte-ignore a11y-no-static-element-interactions -->
                            <div
                                on:click={() => setActiveCowebsite(coWebsite)}
                                data-testid="tab{index + 1}"
                                class="tab-slot snap-start"
                            >
                                <CoWebsiteTab
                                    {coWebsite}
                                    active={activeCowebsite === coWebsite}
                                    on:close={() => coWebsites.remove(coWebsite)}
                                />
                            </div>
                        {/each}
                    </div>
                </div>

                {#if tabsOverflowing && tabsScrollX < tabsContainer?.scrollWidth - tabsContainer?.clientWidth}
                    <div class="flex-0 w-10">
                        <button
                            class="w-10 h-10 rounded flex items-center justify-center hover:bg-white/10 me-2"
                            on:click={scrollTabsRight}
                        >
                            <IconChevronRight font-size="20" class="text-white" />
                        </button>
                    </div>
                {/if}

                {#if $coWebsites.length > 1}
                    <button
                        type="button"
                        class="open-chip"
                        data-open-chip
                        bind:this={chipElement}
                        aria-expanded={listOpen}
                        aria-haspopup="true"
                        aria-label={$LL.cowebsite.openList()}
                        data-testid="openHereList"
                        on:click={() => openHereListOpenStore.update((open) => !open)}
                    >
                        {$LL.cowebsite.openCount({ count: $coWebsites.length })}
                        <IconChevronDown font-size="16" />
                    </button>
                {/if}
            </div>
        {/if}

        {#if listOpen}
            <div
                class="open-list"
                class:u-surface={!sheet}
                class:u-surface-flat={sheet}
                class:open-list-sheet={sheet}
                bind:this={listElement}
                role="menu"
                data-testid="openHereListMenu"
            >
                {#if sheet}<span class="open-list-grabber" aria-hidden="true" />{/if}
                {#each $coWebsites as coWebsite (coWebsite.getId())}
                    {@const item = describeCoWebsite(coWebsite, $LL)}
                    <div class="open-list-row" class:picked={coWebsite === activeCowebsite}>
                        <button
                            type="button"
                            class="open-list-main"
                            role="menuitem"
                            on:click={() => pickFromList(coWebsite)}
                        >
                            <OpenHereItemIcon
                                badge={item.badge}
                                src={item.iconSrc}
                                background={item.iconBackground}
                                size={28}
                            />
                            <span class="open-list-text">
                                <b>{item.name}</b>
                                {#if item.line}<small>{item.line}</small>{/if}
                            </span>
                        </button>
                        {#if coWebsite.isClosable()}
                            <button
                                type="button"
                                class="open-list-x"
                                aria-label={$LL.cowebsite.closeItem({ name: item.name })}
                                title={$LL.cowebsite.close()}
                                on:click={() => closeFromList(coWebsite)}
                            >
                                <IconX font-size="16" />
                            </button>
                        {/if}
                    </div>
                {/each}
                <button type="button" class="open-list-all" on:click={closeAllFromList}>
                    {$LL.cowebsite.closeAll()}
                </button>
            </div>
        {/if}

        <div class="flex-1 min-h-0">
            {#each $coWebsites as coWebsite (coWebsite.getId())}
                {#if coWebsite instanceof JitsiCoWebsite}
                    <JitsiCowebsiteComponent actualCowebsite={coWebsite} visible={coWebsite === activeCowebsite} />
                {:else if coWebsite instanceof BBBCoWebsite}
                    <BigBlueButtonCowebsiteComponent
                        actualCowebsite={coWebsite}
                        visible={coWebsite === activeCowebsite}
                    />
                {:else if coWebsite instanceof FileViewerCoWebsite}
                    <FileViewerCowebsiteComponent actualCowebsite={coWebsite} visible={coWebsite === activeCowebsite} />
                {:else if coWebsite instanceof SimpleCoWebsite}
                    <SimpleCowebsiteComponent
                        actualCowebsite={coWebsite}
                        allowApi={coWebsite.getAllowApi()}
                        visible={coWebsite === activeCowebsite}
                    />
                {/if}
            {/each}
        </div>
    </div>
</div>

<style>
    /* In the window the card is the surface: a file sits flush in it, square, with the card's rounded corners clipping. */
    .cowebsite-window :global(.viewer) {
        border-radius: 0;
        box-shadow: none;
    }

    /* In the phone's sheet the sheet is the surface: the row sits on it, and only the file's own stage has a colour. */
    .in-sheet :global(.viewer) {
        background: transparent;
    }

    /* Expanded, the pill sits at the top right of the screen: the tabs, or a file's header with no tabs above it, keep
       clear of it. */
    .expanded-tabs,
    .pill-over-header :global(.open-here-row) {
        padding-inline-end: 136px;
    }

    /* "N open": neutral, and only its arrow turns when the list is showing. */
    /* Tabs share the strip before it scrolls: on a phone two of them stay in view, each keeping its icon and its close. */
    .tab-slot {
        flex: 0 1 auto;
        min-width: 104px;
        max-width: 220px;
    }

    .open-chip {
        box-sizing: border-box;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        flex: none;
        height: 40px;
        margin-inline: 8px;
        padding: 0 10px 0 14px;
        border: 0;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        color: #fff;
        font-family: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        font-size: 14px;
        font-weight: 600;
        white-space: nowrap;
        cursor: pointer;
    }

    .open-chip:hover,
    .open-chip[aria-expanded="true"] {
        background: rgba(255, 255, 255, 0.14);
    }

    .open-chip[aria-expanded="true"] :global(svg) {
        transform: rotate(180deg);
    }

    /* The list: a menu under the chip, on the window's surface. */
    .open-list {
        position: absolute;
        top: 60px;
        inset-inline-end: 8px;
        z-index: 5;
        box-sizing: border-box;
        width: min(320px, calc(100% - 16px));
        max-height: calc(100% - 76px);
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 8px;
        border-radius: 18px;
        color: #fff;
        font-family: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    }

    .open-list-row {
        display: flex;
        align-items: center;
        gap: 2px;
        min-height: 48px;
        border-radius: 12px;
    }

    .open-list-row:hover {
        background: rgba(255, 255, 255, 0.08);
    }

    .open-list-row.picked {
        background: rgba(134, 41, 252, 0.14);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.7);
    }

    .open-list-main {
        box-sizing: border-box;
        display: flex;
        align-items: center;
        gap: 10px;
        flex: 1;
        min-width: 0;
        min-height: 48px;
        padding: 4px 6px 4px 8px;
        border: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        text-align: start;
        cursor: pointer;
    }

    .open-list-text {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        line-height: 1.2;
    }

    .open-list-text b {
        font-size: 14px;
        font-weight: 600;
        text-transform: none;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .open-list-text small {
        font-size: 11px;
        opacity: 0.6;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .open-list-x {
        box-sizing: border-box;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: none;
        width: 44px;
        height: 44px;
        padding: 0;
        border: 0;
        border-radius: 999px;
        background: transparent;
        color: #fff;
        opacity: 0.8;
        cursor: pointer;
    }

    .open-list-x:hover {
        background: rgba(255, 255, 255, 0.14);
        opacity: 1;
    }

    .open-list-all {
        box-sizing: border-box;
        margin-top: 6px;
        height: 44px;
        border: 0;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        color: #fff;
        font-family: inherit;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
    }

    .open-list-all:hover {
        background: rgba(255, 255, 255, 0.14);
    }

    /* On a phone the list is a sheet from the bottom of the one the items sit in, with its own grabber. */
    .open-list.open-list-sheet {
        top: auto;
        bottom: 0;
        inset-inline: 0;
        width: auto;
        max-height: 70%;
        padding: 8px 12px calc(16px + env(safe-area-inset-bottom, 0px));
        border-radius: 24px 24px 0 0;
        box-shadow: 0 -12px 32px rgba(0, 0, 0, 0.45);
    }

    .open-list-grabber {
        display: block;
        flex: none;
        width: 40px;
        height: 5px;
        margin: 2px auto 10px;
        border-radius: 9999px;
        background: rgba(255, 255, 255, 0.28);
    }

    .open-list-sheet .open-list-main {
        padding-inline-start: 12px;
    }
</style>
