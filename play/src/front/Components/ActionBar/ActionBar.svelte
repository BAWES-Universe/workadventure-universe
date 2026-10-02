<script lang="ts">
    import { get } from "svelte/store";
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
    import { rightActionBarMenuItems } from "../../Stores/MenuStore";
    import { IconChevronUp } from "../Icons";
    import { LL } from "../../../i18n/i18n-svelte";
    import { hideActionBarStoreBecauseOfChatBar } from "../../Chat/ChatSidebarWidthStore";
    import { screenSharingAvailableStore } from "../../Stores/ScreenSharingStore";
    import { isInRemoteConversation } from "../../Stores/StreamableCollectionStore";
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

    let firstVisibleItemIndex = 0;

    function onMenuItemVisibilityChange(isVisible: boolean, button: RightMenuItem<SvelteComponentTyped>) {
        button.fallsInBurgerMenuStore.set(!isVisible);

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
    <ResponsiveActionBar bind:rightDiv bind:actionBarWidth>
        <div slot="left" class="justify-start flex-none">
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
                    <div class="group/hardware flex items-center relative">
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
                                    class="device-arrow group-hover/hardware:opacity-100 group-focus-within/hardware:opacity-100"
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

                        <!-- NAV : SCREENSHARING START -->
                        {#if $screenSharingAvailableStore}
                            <ScreenSharingMenuItem />
                            {#if $isInRemoteConversation}
                                <PictureInPictureMenuItem />
                            {/if}
                        {/if}
                        <!-- NAV : SCREENSHARING END -->
                    </div>
                </div>
            </div>
            <!-- NAV : SILENT BLOCK -->
            {#if $silentStore}
                <SilentBlock />
            {/if}
        </div>

        <div slot="right" id="action-wrapper" class="flex flex-1 justify-end gap-1 @md/actions:gap-2 @xl/actions:gap-4">
            <div class="flex flex-row flex-0 gap-0">
                {#if rightDiv}
                    {#each $rightActionBarMenuItems as button, index (button.id)}
                        <VisibilityChecker
                            parent={rightDiv}
                            onVisibilityChange={(visibility) => onMenuItemVisibilityChange(visibility, button)}
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
                <ProfileMenu />
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
