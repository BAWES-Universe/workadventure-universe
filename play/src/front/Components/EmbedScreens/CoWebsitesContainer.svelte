<script lang="ts">
    import { afterUpdate, onDestroy, onMount, setContext } from "svelte";
    import { get, writable, type Unsubscriber } from "svelte/store";
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
    import { openHereTuckedStore } from "../../Stores/SideWindowInFrontStore";
    import { openHereListOpenStore } from "../../Stores/OpenHereSheetStore";
    import SheetHandle from "../Sheet/SheetHandle.svelte";
    import LL from "../../../i18n/i18n-svelte";
    import CoWebsiteTab from "./CoWebsiteTab.svelte";
    import OpenHereItemIcon from "./OpenHereItemIcon.svelte";
    import OpenHereCountChip from "./OpenHereCountChip.svelte";
    import { OPEN_HERE_ROW_END, type OpenHereRowEnd } from "./openHereRowEnd";
    import { describeCoWebsite } from "./describeCoWebsite";
    import { IconChevronLeft, IconChevronRight, IconX } from "@wa-icons";

    /**
     * On a phone held upright the window is chat's own sheet (OpenHereWindow draws it around this): no strip of tabs,
     * the row of the picked item ends with the "N open" chip and the close, and the list opens as a sheet.
     */
    export let sheet = false;

    // The row of every item (OpenHereRow) ends with the chip and the close in the sheet, where there is no strip.
    const rowEnd = writable<OpenHereRowEnd | undefined>(undefined);
    setContext(OPEN_HERE_ROW_END, rowEnd);
    // A page that may not be closed leaves nothing for the close to do: it is not drawn then.
    $: rowEnd.set(
        sheet
            ? {
                  count: $coWebsites.length,
                  listOpen,
                  toggleList,
                  closable: $coWebsites.some((coWebsite) => coWebsite.isClosable()),
                  close: closeAllOpenItems,
              }
            : undefined
    );

    //let container: HTMLElement;
    let activeCowebsite: CoWebsite = $coWebsites[0];
    let containerElement: HTMLElement | undefined;
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
        openHereListOpenStore.set(false);

        unsubscribeCowebsitesUpdate?.();
        unsubscribePickedAfterUndo?.();
    });

    // An item on its own has its own row (icon, name, its actions), so the strip of tabs would only add a second row
    // above it. With other panels open the tabs come back, so the person can still switch between them. The sheet has no
    // strip at all: the chip in the row lists everything.
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
    let listOpen = false;
    let listElement: HTMLElement | undefined;
    $: if ($coWebsites.length < 2) listOpen = false;
    // The chat button floats over the bottom corner of the sheet, where the list's Close all is: it waits while the list
    // is open.
    $: openHereListOpenStore.set(sheet && listOpen);

    // The list sheet's handle: drag it down to put the list away, or tap it. The list follows the finger, and goes
    // when it is let go far enough down; otherwise it springs back.
    const LIST_DISMISS_SHARE = 0.3;
    let listHeight = 0;
    let listDragOffset: number | undefined;

    function onListDrag(height: number) {
        listDragOffset = Math.max(0, listHeight - height);
    }

    function onListRelease(height: number) {
        const offset = Math.max(0, listHeight - height);
        listDragOffset = undefined;
        if (offset > listHeight * LIST_DISMISS_SHARE) listOpen = false;
    }

    function onListTap() {
        listOpen = false;
    }

    $: if (!listOpen) listDragOffset = undefined;

    // The chip is the strip's on a desktop and the row's in the sheet, so it is told apart by its mark.
    const CHIP_SELECTOR = "[data-open-chip]";

    function toggleList() {
        // A sheet tucked above the bar comes back up with its list.
        if ($openHereTuckedStore) {
            openHereTuckedStore.set(false);
            listOpen = true;
        } else {
            listOpen = !listOpen;
        }
    }

    function focusChip() {
        const chips = Array.from(containerElement?.querySelectorAll<HTMLElement>(CHIP_SELECTOR) ?? []);
        chips.find((chip) => chip.offsetParent !== null)?.focus();
    }

    function pickFromList(coWebsite: CoWebsite) {
        if (activeCowebsite !== coWebsite) analyticsClient.switchCowebsite();
        setActiveCowebsite(coWebsite);
        listOpen = false;
    }

    function closeFromList(coWebsite: CoWebsite) {
        coWebsites.remove(coWebsite);
        analyticsClient.closeCowebsite();
    }

    function closeAllFromList() {
        listOpen = false;
        closeAllOpenItems();
    }

    function onWindowPointerDown(event: PointerEvent) {
        if (!listOpen) return;
        const target = event.target as Node | null;
        if (target && (listElement?.contains(target) || (target as Element).closest?.(CHIP_SELECTOR))) return;
        listOpen = false;
    }

    // Esc closes the list first, and leaves the window alone, wherever the focus is (capture: before the window's own Esc).
    function onWindowKeyDownCapture(event: KeyboardEvent) {
        if (event.key === "Escape" && listOpen) {
            // The emote picker, the express tray and a picture shown large take their own Esc, as the window leaves it to them.
            if ($emoteMenuStore || $expressTrayStore !== "closed" || $lightboxOpenStore) return;
            event.preventDefault();
            // Nothing else takes this Esc, such as the find bar of a file.
            event.stopPropagation();
            listOpen = false;
            focusChip();
        }
    }

    // A click on a page inside the window never reaches this window, but the game loses the focus to it: the list closes
    // too. Switching to another app also blurs the game, with the focus left where it was, and nothing changes.
    function onWindowBlur() {
        if (!listOpen) return;
        setTimeout(() => {
            if (document.hasFocus() && document.activeElement instanceof HTMLIFrameElement) listOpen = false;
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
    bind:this={containerElement}
    class="w-full h-full relative cowebsite-window"
    class:pill-over-header={!sheet && $fullScreenCowebsite && soleItem}
    class:in-sheet={sheet}
>
    <div class="h-full w-full flex flex-col">
        <!-- The window's card sits under the bar and starts below the inset itself; expanded, the pill sits at the top
             right and the tabs keep clear of it. -->
        <div
            class="flex pb-2 ms-3 items-center height-tab overflow-hidden flex-none pt-2"
            class:hidden={soleItem || sheet}
            class:expanded-tabs={!sheet && $fullScreenCowebsite}
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

            <!-- The sheet has no strip: its chip is in the row (OpenHereRow). -->
            {#if $coWebsites.length > 1 && !sheet}
                <OpenHereCountChip count={$coWebsites.length} open={listOpen} on:click={toggleList} />
            {/if}
        </div>

        {#if listOpen}
            <div
                class="open-list"
                class:u-surface={!sheet}
                class:u-surface-flat={sheet}
                class:in-sheet={sheet}
                class:dragging={listDragOffset !== undefined}
                style={listDragOffset ? `transform: translateY(${listDragOffset}px)` : undefined}
                bind:this={listElement}
                bind:clientHeight={listHeight}
                role="menu"
                data-testid="openHereListMenu"
            >
                {#if sheet}
                    <div class="open-list-handle">
                        <SheetHandle
                            sheetHeight={listHeight}
                            onDrag={onListDrag}
                            onRelease={onListRelease}
                            onTap={onListTap}
                            label={$LL.cowebsite.sheetHandle()}
                            testId="openHereListHandle"
                        />
                    </div>
                {/if}
                {#each $coWebsites as coWebsite, index (coWebsite.getId())}
                    {@const item = describeCoWebsite(coWebsite, $LL)}
                    <div class="open-list-row" class:picked={coWebsite === activeCowebsite}>
                        <button
                            type="button"
                            class="open-list-main"
                            role="menuitem"
                            data-testid="openHereListItem{index + 1}"
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
    .cowebsite-window.in-sheet :global(.viewer) {
        background: transparent;
    }

    /* Expanded, the pill sits at the top right of the screen: the tabs, or a file's header with no tabs above it, keep
       clear of it. */
    .expanded-tabs,
    .pill-over-header :global(.open-here-row) {
        padding-inline-end: 136px;
    }

    /* Tabs share the strip before it scrolls: on a phone two of them stay in view, each keeping its icon and its close. */
    .tab-slot {
        flex: 0 1 auto;
        min-width: 104px;
        max-width: 220px;
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

    /* In the sheet the list is a sheet too: it rises from the bottom of the window, over the page. */
    .open-list.in-sheet {
        top: auto;
        bottom: 0;
        inset-inline: 0;
        width: auto;
        max-height: 100%;
        padding: 0 16px calc(16px + env(safe-area-inset-bottom, 0px));
        border-radius: 24px 24px 0 0;
    }

    /* The handle takes the whole width of the sheet, past the list's own side padding. */
    .open-list-handle {
        flex: none;
        margin: 0 -16px 4px;
    }

    .open-list.in-sheet {
        transition: transform 160ms ease-out;
    }

    .open-list.in-sheet.dragging {
        transition: none;
    }

    @media (prefers-reduced-motion: reduce) {
        .open-list.in-sheet {
            transition: none;
        }
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
</style>
