<script lang="ts">
    import { afterUpdate, onDestroy, onMount, setContext } from "svelte";
    import { get, writable, type Unsubscriber } from "svelte/store";
    import { titleBarHeightStore } from "../../TitleBar/WindowControlsOverlay";
    import {
        activeCoWebsiteStore,
        coWebsiteRatio,
        coWebsites,
        fullScreenCowebsite,
        windowSize,
    } from "../../Stores/CoWebsiteStore";
    import JitsiCowebsiteComponent from "../Cowebsites/JistiCowebsiteComponent.svelte";
    import SimpleCowebsiteComponent from "../Cowebsites/SimpleCowebsiteComponent.svelte";
    import FileViewerCowebsiteComponent from "../Cowebsites/FileViewerCowebsiteComponent.svelte";
    import { JitsiCoWebsite } from "../../WebRtc/CoWebsite/JitsiCoWebsite";
    import { SimpleCoWebsite } from "../../WebRtc/CoWebsite/SimpleCoWebsite";
    import { FileViewerCoWebsite } from "../../WebRtc/CoWebsite/FileViewerCoWebsite";
    import { BBBCoWebsite } from "../../WebRtc/CoWebsite/BBBCoWebsite";
    import BigBlueButtonCowebsiteComponent from "../Cowebsites/BigBlueButtonCowebsiteComponent.svelte";
    import type { CoWebsite } from "../../WebRtc/CoWebsite/CoWebsite";
    import { screenOrientationStore } from "../../Stores/ScreenOrientationStore";
    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import { closeAllOpenItems, pickedAfterUndoStore } from "../../Stores/ClosedItemsStore";
    import LL from "../../../i18n/i18n-svelte";
    import CoWebsiteTab from "./CoWebsiteTab.svelte";
    import OpenHereItemIcon from "./OpenHereItemIcon.svelte";
    import { describeCoWebsite } from "./describeCoWebsite";
    import { IconChevronLeft, IconChevronRight, IconChevronDown, IconArrowsMinimize, IconX } from "@wa-icons";

    /** Inside the Open here window (its card, pill and grip are drawn around this), rather than the split beside the game. */
    export let windowed = false;
    // A file in the split beside the game has no pill to close it: its row keeps the way back.
    const windowedStore = writable(windowed);
    $: windowedStore.set(windowed);
    setContext("openHereWindowed", windowedStore);

    //let container: HTMLElement;
    let activeCowebsite: CoWebsite = $coWebsites[0];
    let resizeBar: HTMLElement | undefined;
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

    const handleMouseDown = () => {
        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);
    };

    const handleTouchStart = () => {
        document.addEventListener("touchmove", handleTouchMove);
        document.addEventListener("touchend", handleTouchEnd);
    };

    const handleMove = (clientX: number, clientY: number) => {
        if ($screenOrientationStore === "landscape") {
            if (document.documentElement.dir === "rtl") {
                // 8 is the number of pixels of the resize bar
                if (clientX < 8) {
                    clientX = 8;
                }
                if (clientX > window.innerWidth) {
                    clientX = window.innerWidth;
                }

                coWebsiteRatio.set(clientX / window.innerWidth);
            } else {
                if (clientX < 0) {
                    clientX = 0;
                }
                // 8 is the number of pixels of the resize bar
                if (clientX > window.innerWidth - 8) {
                    clientX = window.innerWidth - 8;
                }
                coWebsiteRatio.set((window.innerWidth - clientX) / window.innerWidth);
            }
        } else {
            // The page sits under the desktop title bar strip, so the pointer is measured from the page's top edge
            clientY -= get(titleBarHeightStore);
            // 8 is the number of pixels of the resize bar
            if (clientY < 8) {
                clientY = 8;
            }
            // The height the split is drawn over: the browser window, less the strip.
            const height = $windowSize.height;
            if (clientY > height) {
                clientY = height;
            }

            coWebsiteRatio.set(clientY / height);
        }
    };

    const handleMouseMove = (e: MouseEvent) => {
        let clientX = e.clientX;
        let clientY = e.clientY;
        handleMove(clientX, clientY);
    };

    const handleTouchMove = (e: TouchEvent) => {
        let clientX = e.touches[0].clientX;
        let clientY = e.touches[0].clientY;
        handleMove(clientX, clientY);
    };
    const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
    };
    const handleTouchEnd = () => {
        document.removeEventListener("touchmove", handleTouchMove);
        document.removeEventListener("touchend", handleTouchEnd);
    };

    function addDivForResize() {
        const div = document.createElement("div");
        div.id = "resize-overlay";
        div.style.width = "100%";
        div.style.height = "100%";
        div.style.position = "absolute";
        div.style.top = "0";
        div.style.right = "0";
        div.style.zIndex = "1800";
        document.body.appendChild(div);
        window.addEventListener("mouseup", removeDivForResize);
    }

    function removeDivForResize() {
        const div = document.getElementById("resize-overlay");
        if (div) {
            document.body.removeChild(div);
        }
        window.removeEventListener("mouseup", removeDivForResize);
    }

    const setActiveCowebsite = (coWebsite: CoWebsite) => {
        activeCowebsite = coWebsite;
    };

    function toggleFullScreen(event: MouseEvent) {
        event.preventDefault();
        event.stopPropagation();

        if ($fullScreenCowebsite) {
            fullScreenCowebsite.set(false);
        } else {
            fullScreenCowebsite.set(true);
            analyticsClient.fullScreenCowebsite();
        }
    }

    onDestroy(() => {
        fullScreenCowebsite.set(false);

        unsubscribeCowebsitesUpdate?.();
        unsubscribePickedAfterUndo?.();

        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.removeEventListener("touchmove", handleTouchMove);
        document.removeEventListener("touchend", handleTouchEnd);
    });

    // Held to the screen's height on a phone held upright: a long file scrolls inside its panel instead of stretching it.
    $: hasFileViewer = $coWebsites.some((coWebsite) => coWebsite instanceof FileViewerCoWebsite);

    // An item on its own has its own row (icon, name, its actions), so the strip of tabs would only add a second row
    // above it. With other panels open the tabs come back, so the person can still switch between them. Without the
    // window's pill (the split panel on an upright phone) only a file keeps its own way back, so a lone website or
    // meeting there keeps the tab with its close.
    $: soleItem = $coWebsites.length === 1 && (windowed || $coWebsites[0] instanceof FileViewerCoWebsite);

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
    let chipElement: HTMLElement | undefined;
    $: if ($coWebsites.length < 2) listOpen = false;

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
        if (target && (listElement?.contains(target) || chipElement?.contains(target))) return;
        listOpen = false;
    }

    // Esc closes the list first, and leaves the window alone, wherever the focus is (capture: before the window's own Esc).
    function onWindowKeyDownCapture(event: KeyboardEvent) {
        if (event.key === "Escape" && listOpen) {
            event.preventDefault();
            // Nothing else takes this Esc, such as the find bar of a file.
            event.stopPropagation();
            listOpen = false;
            chipElement?.focus();
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
    class="w-full h-full relative {windowed
        ? 'cowebsite-window'
        : `bg-contrast/50 backdrop-blur ${!$fullScreenCowebsite ? 'cowebsite-normal' : 'cowebsite-fullscreen'}`}"
    class:pill-over-header={windowed && $fullScreenCowebsite && soleItem}
    style={windowed ? undefined : "transition: background-color 0.2s ease-in-out, backdrop-filter 0.2s ease-in-out;"}
>
    <div class="h-full w-full flex flex-col">
        <!-- The tabs lead the page on a phone held upright, where the installed app's status bar is see-through (#969).
             In the window, its card sits under the bar and starts below the inset itself; expanded, the pill sits
             at the top right and the tabs keep clear of it. -->
        <div
            class="flex pb-2 ms-3 items-center height-tab overflow-hidden flex-none {windowed
                ? 'pt-2'
                : 'pt-[calc(8px+env(safe-area-inset-top))]'}"
            class:hidden={soleItem}
            class:expanded-tabs={windowed && $fullScreenCowebsite}
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
                            class="snap-start"
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
                    bind:this={chipElement}
                    aria-expanded={listOpen}
                    aria-haspopup="true"
                    aria-label={$LL.cowebsite.openList()}
                    data-testid="openHereList"
                    on:click={() => (listOpen = !listOpen)}
                >
                    {$LL.cowebsite.openCount({ count: $coWebsites.length })}
                    <IconChevronDown font-size="16" />
                </button>
            {/if}

            {#if !windowed}
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <!-- svelte-ignore a11y-no-static-element-interactions -->
                <div class="flex justify-end w-10 flex-none">
                    <div
                        class="ms-full h-10 w-10 rounded flex items-center justify-center hover:bg-white/10 me-2 cursor-pointer"
                        on:click={toggleFullScreen}
                    >
                        {#if !$fullScreenCowebsite}
                            <IconArrowsMinimize font-size="20" class="text-white" />
                        {:else}
                            <IconArrowsMinimize font-size="20" class="text-white" />
                        {/if}
                    </div>
                </div>
            {/if}
        </div>

        {#if listOpen}
            <div class="open-list u-surface" bind:this={listElement} role="menu" data-testid="openHereListMenu">
                {#each $coWebsites as coWebsite (coWebsite.getId())}
                    {@const item = describeCoWebsite(coWebsite)}
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

        <div
            class={windowed
                ? "flex-1 min-h-0"
                : $screenOrientationStore === "portrait"
                ? "flex-1 mb-3"
                : "h-full object-contain ms-3"}
            class:min-h-0={hasFileViewer}
            style={!windowed && soleItem ? "padding-top: env(safe-area-inset-top, 0px)" : undefined}
        >
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
    {#if !windowed}
        <!-- We make the drag handle bigger than it really is to make it more easily selectable (especially on mobile) with "after" pseudo element -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div
            class={$screenOrientationStore === "portrait"
                ? "-mt-1.5 mx-auto w-40 h-1 bg-white rounded cursor-row-resize relative after:content-[''] after:absolute after:-start-4 after:-top-1  after:w-48 after:h-6"
                : "absolute start-1 top-0 bottom-0 m-auto w-1 h-40 bg-white rounded cursor-col-resize after:content-[''] after:absolute after:-start-4 after:-top-4 after:h-48 after:w-6"}
            class:hidden={$fullScreenCowebsite}
            bind:this={resizeBar}
            on:mousedown={handleMouseDown}
            on:mousedown={addDivForResize}
            on:mouseup={removeDivForResize}
            on:touchstart={handleTouchStart}
            on:touchstart={addDivForResize}
            on:touchstart={() => {
                /*isResized.set(true)*/
            }}
            on:dragend={removeDivForResize}
            on:touchend={removeDivForResize}
        />
    {/if}
</div>

<style>
    /* In the window the card is the surface: a file sits flush in it, square, with the card's rounded corners clipping. */
    .cowebsite-window :global(.viewer) {
        border-radius: 0;
        box-shadow: none;
    }

    /* Expanded, the pill sits at the top right of the screen: the tabs, or a file's header with no tabs above it, keep
       clear of it. */
    .expanded-tabs,
    .pill-over-header :global(.open-here-row) {
        padding-inline-end: 136px;
    }

    /* "N open": neutral, and only its arrow turns when the list is showing. */
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

    .cowebsite-normal {
        position: relative;
        z-index: 1;
    }

    .cowebsite-fullscreen {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 1000;
    }
</style>
