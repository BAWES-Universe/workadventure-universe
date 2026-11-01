<script lang="ts">
    import { get } from "svelte/store";
    import { onDestroy } from "svelte";
    import type { SvelteComponentTyped } from "svelte";
    import { silentStore } from "../../Stores/MediaStore";

    import { gameManager } from "../../Phaser/Game/GameManager";
    import { chatVisibilityStore } from "../../Stores/ChatStore";
    import {
        inExternalServiceStore,
        myCameraStore,
        myMicrophoneStore,
        proximityMeetingStore,
    } from "../../Stores/MyMediaStore";
    import type { RightMenuItem } from "../../Stores/MenuStore";
    import { closeMenuOfHiddenBarItem, exploreShortLabelStore, rightActionBarMenuItems } from "../../Stores/MenuStore";
    import { IconChevronUp } from "../Icons";
    import { LL } from "../../../i18n/i18n-svelte";
    import { hideActionBarStoreBecauseOfChatBar } from "../../Chat/ChatSidebarWidthStore";
    import { screenSharingAvailableStore } from "../../Stores/ScreenSharingStore";
    import { isInRemoteConversation } from "../../Stores/StreamableCollectionStore";
    import { mobileLayoutStore } from "../../Stores/MobileLayoutStore";
    import { chatSheetLayoutStore } from "../../Chat/ChatSheetStore";
    import { deviceListOpenRequestStore } from "../../Stores/NewDeviceStore";
    import MediaSettingsList from "./MediaSettingsList.svelte";
    import CameraMenuItem from "./MenuIcons/CameraMenuItem.svelte";
    import MicrophoneMenuItem from "./MenuIcons/MicrophoneMenuItem.svelte";
    import ScreenSharingMenuItem from "./MenuIcons/ScreenSharingMenuItem.svelte";
    import ChatMenuItem from "./MenuIcons/ChatMenuItem.svelte";
    import UserListMenuItem from "./MenuIcons/UserListMenuItem.svelte";
    import ResponsiveActionBar from "./ResponsiveActionBar.svelte";
    import ProfileMenu from "./MenuIcons/ProfileMenu.svelte";
    import VisibilityChecker from "./VisibilityChecker.svelte";
    import ContextualMenuItems from "./MenuIcons/ContextualMenuItems.svelte";
    import CloseChatMenuItem from "./MenuIcons/CloseChatMenuItem.svelte";
    import SilentBlock from "./SilentBlock.svelte";
    import PictureInPictureMenuItem from "./MenuIcons/PictureInPictureMenuItem.svelte";

    let rightDiv: HTMLDivElement;
    let mediaSettingsDisplayed = false;
    let smallArrowVisible = true;
    let actionBarWidth: number;

    const gameScene = gameManager.getCurrentGameScene();
    const showChatButton = gameScene.room.isChatEnabled;
    const showUserListButton = gameScene.room.isChatOnlineListEnabled;

    $: isSmallScreen = actionBarWidth < 640;
    // On a phone held upright the chat rises from the bottom, so its button can sit under the right thumb, below
    // Express; the menu takes the bottom left corner. (While the chat is open the bar is hidden.)
    $: swapped = $chatSheetLayoutStore;

    // "Choose device" on the new device card opens the list.
    $: if ($deviceListOpenRequestStore) {
        mediaSettingsDisplayed = true;
        deviceListOpenRequestStore.set(false);
    }

    let firstVisibleItemIndex = 0;

    // Desktop bar short of room (#1734). Before a button has to move into the menu, Explore drops the universe's name;
    // a button in the menu leaves no gap (VisibilityChecker's collapse); and as soon as there is room again, the button
    // comes back first, then Explore's full name. FIT_MARGIN keeps a button from coming back at a width where it
    // would go straight back into the menu.
    const FIT_MARGIN = 16;
    let freeWidth = 0;
    const itemWidths: Record<string, number> = {};
    let foldedIds = new Set<string>();
    let comingBack: string | undefined = undefined;
    let comingBackTimer: ReturnType<typeof setTimeout> | undefined = undefined;
    // Explore's width with its full name and with "Explore" alone, each read while it showed.
    const exploreWidths: { long?: number; short?: number } = {};

    $: desktopBar = !$mobileLayoutStore;
    $: recordExploreWidth(itemWidths["explore"]);
    function recordExploreWidth(width: number | undefined) {
        if (!width) return;
        if ($exploreShortLabelStore) exploreWidths.short = width;
        else exploreWidths.long = width;
    }

    $: fitBar(freeWidth, foldedIds, $rightActionBarMenuItems, desktopBar);
    // Shortening happens at once; giving room back waits until the bar has settled for GROW_DELAY ms, so the widths
    // read while buttons are still appearing (entering a meeting room) don't flip Explore's name back and forth.
    const GROW_DELAY = 150;
    let growTimer: ReturnType<typeof setTimeout> | undefined = undefined;
    function fitBar(
        free: number,
        folded: Set<string>,
        items: RightMenuItem<SvelteComponentTyped>[],
        desktop: boolean,
        settled = false
    ) {
        if (!desktop) {
            exploreShortLabelStore.set(false);
            return;
        }
        // Short of room: Explore shortens first. (Only buttons still in the list count: one that left the bar while
        // in the menu, Orbit for instance, is not waiting for room.)
        const anyInMenu = items.some((item) => folded.has(item.id));
        if ((anyInMenu || free < 0) && !get(exploreShortLabelStore)) exploreShortLabelStore.set(true);

        const grow = nextGrowth(free, folded, items);
        if (grow === undefined) {
            clearTimeout(growTimer);
            growTimer = undefined;
        } else if (settled) {
            grow();
        } else if (growTimer === undefined) {
            growTimer = setTimeout(() => {
                growTimer = undefined;
                fitBar(freeWidth, foldedIds, get(rightActionBarMenuItems), desktopBar, true);
            }, GROW_DELAY);
        }
    }

    function nextGrowth(
        free: number,
        folded: Set<string>,
        items: RightMenuItem<SvelteComponentTyped>[]
    ): (() => void) | undefined {
        if (comingBack !== undefined) return undefined;
        // The button in the menu nearest the bar comes back first, once its whole width fits.
        const nextBack = [...items].reverse().find((item) => folded.has(item.id));
        if (nextBack !== undefined) {
            return free >= (itemWidths[nextBack.id] ?? Infinity) + FIT_MARGIN
                ? () => bringBack(nextBack.id)
                : undefined;
        }
        // Nothing in the menu: Explore gets its full name back once that fits too.
        if (!get(exploreShortLabelStore)) return undefined;
        const current = itemWidths["explore"] ?? 0;
        const extra = (exploreWidths.long ?? current) - (exploreWidths.short ?? current);
        return free >= extra + FIT_MARGIN ? () => exploreShortLabelStore.set(false) : undefined;
    }

    // Takes the button's room back for a moment; the observer then confirms it fits and shows it.
    function bringBack(id: string) {
        comingBack = id;
        clearTimeout(comingBackTimer);
        comingBackTimer = setTimeout(() => {
            if (comingBack === id) comingBack = undefined;
        }, 400);
    }

    onDestroy(() => {
        clearTimeout(comingBackTimer);
        clearTimeout(growTimer);
    });

    function onMenuItemVisibilityChange(isVisible: boolean, button: RightMenuItem<SvelteComponentTyped>) {
        button.fallsInBurgerMenuStore.set(!isVisible);
        if (!isVisible) closeMenuOfHiddenBarItem(button.id);
        if (isVisible) foldedIds.delete(button.id);
        else foldedIds.add(button.id);
        foldedIds = foldedIds;
        if (isVisible && comingBack === button.id) comingBack = undefined;

        // Let's recompute the first visible item index
        for (let i = 0; i < $rightActionBarMenuItems.length; i++) {
            if (!get($rightActionBarMenuItems[i].fallsInBurgerMenuStore)) {
                firstVisibleItemIndex = i;
                break;
            }
        }
    }
</script>

{#if !$hideActionBarStoreBecauseOfChatBar}
    <ResponsiveActionBar bind:rightDiv bind:actionBarWidth bind:freeWidth>
        <div slot="left" class="justify-start flex-none">
            {#if swapped}
                <ProfileMenu />
            {:else}
                <div class="flex relative transition-all duration-150 z-[2]" data-testid="chat-action">
                    {#if !$chatVisibilityStore}
                        <ChatMenuItem chatEnabledInAdmin={showChatButton} last={isSmallScreen ? true : undefined} />
                        {#if !isSmallScreen && showUserListButton}
                            <UserListMenuItem state={showUserListButton ? "normal" : "disabled"} />
                        {/if}
                    {:else}
                        <CloseChatMenuItem />
                    {/if}
                </div>
            {/if}
        </div>

        <div
            slot="center"
            class="@xxs/actions:justify-center justify-end main-action pointer-events-auto min-w-32 @sm/actions:min-w-[192px]"
        >
            <div
                class="flex justify-center relative gap-1 @md/actions:gap-2 @xl/actions:gap-4 z-[1] mx-1 @md/actions:mx-2 @xl/actions:mx-4"
            >
                <div class="hidden @sm/actions:flex items-center">
                    <ContextualMenuItems />
                </div>

                <div>
                    <!-- ACTION WRAPPER : CAM & MIC -->
                    <div class="hardware group/hardware flex items-center relative">
                        {#if !$inExternalServiceStore && $proximityMeetingStore && $myMicrophoneStore}
                            <MicrophoneMenuItem />
                        {/if}

                        {#if smallArrowVisible}
                            <!-- The device arrow sits on the seam between the microphone and the camera: this anchor
                                 takes no width, so the tab is centred on the seam at every bar size. A span, not a
                                 div, so the segments' first/last-of-type rounding ignores it. -->
                            <span class="device-arrow-anchor relative self-stretch w-0 z-10">
                                <button
                                    type="button"
                                    class="device-arrow"
                                    class:open={mediaSettingsDisplayed}
                                    aria-label={$LL.actionbar.editCamMic()}
                                    aria-expanded={mediaSettingsDisplayed}
                                    on:click|stopPropagation|preventDefault={() =>
                                        (mediaSettingsDisplayed = !mediaSettingsDisplayed)}
                                >
                                    <span class="device-arrow-tab u-surface-flat">
                                        <IconChevronUp
                                            stroke={2}
                                            class="device-arrow-chevron aspect-square transition-transform {mediaSettingsDisplayed
                                                ? ''
                                                : 'rotate-180'}"
                                        />
                                    </span>
                                </button>
                            </span>
                        {/if}
                        {#if mediaSettingsDisplayed}
                            <MediaSettingsList on:close={() => (mediaSettingsDisplayed = false)} />
                        {/if}
                        <!-- NAV : CAMERA START -->
                        {#if !$inExternalServiceStore && $myCameraStore}
                            <CameraMenuItem />
                        {/if}
                        <!-- NAV : CAMERA END -->

                        <!-- NAV : SCREENSHARING START (phones have it in the menu, beside Follow and Lock) -->
                        {#if $screenSharingAvailableStore && !$mobileLayoutStore}
                            <ScreenSharingMenuItem />
                            {#if $isInRemoteConversation}
                                <PictureInPictureMenuItem />
                            {/if}
                        {/if}
                        <!-- NAV : SCREENSHARING END -->
                    </div>
                </div>
            </div>
            <!-- NAV : SILENT BLOCK (bar at the top: under the microphone and camera, as before) -->
            {#if $silentStore && !$mobileLayoutStore}
                <SilentBlock placement="below" />
            {/if}
        </div>

        <!-- NAV : SILENT BLOCK (phones, bar at the bottom: above the whole bar, centred on the screen) -->
        <svelte:fragment slot="overlay">
            {#if $silentStore && $mobileLayoutStore}
                <SilentBlock placement="above" />
            {/if}
        </svelte:fragment>

        <div slot="right" id="action-wrapper" class="flex flex-1 justify-end gap-1 @md/actions:gap-2 @xl/actions:gap-4">
            <div class="flex flex-row flex-0 gap-0">
                {#if rightDiv}
                    {#each $rightActionBarMenuItems as button, index (button.id)}
                        <VisibilityChecker
                            parent={rightDiv}
                            onVisibilityChange={(visibility) => onMenuItemVisibilityChange(visibility, button)}
                            collapse={desktopBar && comingBack !== button.id}
                            bind:width={itemWidths[button.id]}
                        >
                            <svelte:component
                                this={button.component}
                                {...button.props}
                                first={firstVisibleItemIndex === index}
                                classList={button.props.last && index !== $rightActionBarMenuItems.length - 1
                                    ? "me-1 @md/actions:me-2 @xl/actions:me-4"
                                    : ""}
                            />
                        </VisibilityChecker>
                    {/each}
                {/if}
            </div>

            <div class="flex justify-end gap-1 md:gap-2 xl:gap-4">
                {#if swapped}
                    <div class="flex relative transition-all duration-150 z-[2]" data-testid="chat-action">
                        <ChatMenuItem chatEnabledInAdmin={showChatButton} last={true} />
                    </div>
                {:else}
                    <ProfileMenu />
                {/if}
            </div>
        </div>
    </ResponsiveActionBar>
{/if}

<style lang="scss">
    /* The device arrow: a small ink pill like the bar's own, centred on the microphone | camera seam. It hangs below
       the bar on desktop (shown on hover, focus, or while the list is open) and sits above it on phones (always
       shown). The brand gradient means "open", as it means "on" everywhere else in the bar. */
    .device-arrow {
        position: absolute;
        left: 0;
        top: calc(100% + 2px);
        transform: translateX(-50%);
        display: flex;
        align-items: flex-start;
        justify-content: center;
        /* The whole box takes the tap: 40x22 around a 32x18 tab. */
        width: 40px;
        height: 22px;
        padding-top: 2px;
        background: transparent;
        border: 0;
        cursor: pointer;
        opacity: 0;
        transition: opacity 150ms ease;
        -webkit-tap-highlight-color: transparent;
    }
    /* Shown while the pointer is over the microphone or camera, while either has the keyboard focus, and while the
       list is open. Written here, not as Tailwind group-hover classes: this component's own opacity: 0 outranks
       those, which left the arrow invisible until clicked. */
    .hardware:hover .device-arrow,
    .hardware:focus-within .device-arrow,
    .device-arrow.open,
    .device-arrow:focus-visible {
        opacity: 1;
    }
    @media (hover: none) {
        .device-arrow {
            opacity: 1;
        }
    }
    .device-arrow:focus-visible {
        outline: none;
    }
    .device-arrow-tab {
        display: grid;
        place-items: center;
        width: 32px;
        height: 18px;
        border-radius: 9999px;
        color: #fff;
        transition: background 150ms ease;
    }
    .device-arrow:focus-visible .device-arrow-tab {
        box-shadow: 0 0 0 2px #fff;
    }
    @media (hover: hover) {
        .device-arrow:hover .device-arrow-tab {
            background: linear-gradient(180deg, rgb(48 44 70 / 0.95), rgb(var(--u-ink) / 0.95));
        }
    }
    .device-arrow.open .device-arrow-tab {
        background: linear-gradient(135deg, #8629fc, #4156f6);
        box-shadow: 0 6px 18px -6px rgba(134, 41, 252, 0.9);
    }
    .device-arrow :global(.device-arrow-chevron) {
        width: 14px;
        height: 14px;
    }
    /* Touch screens with the bar at the top (tablets): the tab looks the same, but a finger gets a 44x44 tap zone. */
    @media (pointer: coarse) {
        .device-arrow {
            width: 44px;
            height: 44px;
        }
    }
    /* Phones (Tailwind's mobile: variant, written as a list the compiler can read): the bar is at the bottom, so the
       tab sits above it, a little bigger, with a 44px tall tap zone. The chevron flips: closed points up (the list
       opens upwards), open points down. */
    @media (max-height: 960px) and (max-width: 480px) and (pointer: coarse),
        (max-height: 480px) and (max-width: 960px) and (pointer: coarse) {
        .device-arrow {
            top: auto;
            bottom: 100%;
            align-items: flex-end;
            width: 44px;
            height: 44px;
            padding-top: 0;
            padding-bottom: 6px;
            opacity: 1;
        }
        .device-arrow-tab {
            width: 36px;
            height: 22px;
            transform: rotate(180deg);
        }
    }
</style>
