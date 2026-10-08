<script lang="ts">
    import { createEventDispatcher, getContext, hasContext } from "svelte";
    import { readable } from "svelte/store";
    import type { Readable } from "svelte/store";
    import LL from "../../../../../i18n/i18n-svelte";
    import type {
        ChatRoom,
        ChatRoomMembershipManagement,
        ChatRoomNotificationControl,
    } from "../../../Connection/ChatConnection";
    import type { PictureStore } from "../../../../Stores/PictureStore";
    import { notificationPlayingStore } from "../../../../Stores/NotificationStore";
    import { PERSON_COLOUR_CONTEXT, WOKA_BY_CHAT_ID_CONTEXT, personPicture } from "../../../Stores/ChatUserWokaStore";
    import type { PersonColourOf } from "../../../Stores/ChatUserWokaStore";
    import { selectedRoomStore } from "../../../Stores/SelectRoomStore";
    import TopRowAvatar from "../../TopRow/TopRowAvatar.svelte";
    import VisitCard from "../../../../Components/VisitCard/VisitCard.svelte";
    import type { DirectPartner } from "./DirectPartnerStore";
    import { isInUniverse } from "./PartnerPlace";
    import { partnerStatus } from "./PartnerStatus";
    import {
        canOpenPartnerProfile,
        canReportPartner,
        locatePartner,
        openPartnerProfile,
        reportPartner,
        setPartnerBlocked,
        walkToPartner,
    } from "./PartnerActions";
    import {
        IconBan,
        IconChevronLeft,
        IconChevronRight,
        IconFlag,
        IconMapPin,
        IconMute,
        IconTrash,
        IconUserCircle,
        IconWalk,
    } from "@wa-icons";

    /**
     * Who you're chatting with, over the conversation: their woka and where they are, quick ways to reach them,
     * their profile card, mute, and the safety actions at the bottom. Back returns to the conversation.
     */
    export let room: ChatRoom & ChatRoomMembershipManagement & ChatRoomNotificationControl;
    export let partner: DirectPartner;

    const dispatch = createEventDispatcher<{ close: void }>();
    const roomName = room.name;
    const areNotificationsMuted = room.areNotificationsMuted;
    const direction = document.documentElement.getAttribute("dir") || "ltr";
    const wokaByChatId: Readable<Map<string, PictureStore>> = hasContext(WOKA_BY_CHAT_ID_CONTEXT)
        ? getContext(WOKA_BY_CHAT_ID_CONTEXT)
        : readable(new Map<string, PictureStore>());
    const colourOf: Readable<PersonColourOf> = hasContext(PERSON_COLOUR_CONTEXT)
        ? getContext(PERSON_COLOUR_CONTEXT)
        : readable(() => undefined);

    let confirmingDelete = false;
    let blockInProgress = false;

    $: picture = personPicture($wokaByChatId, partner.chatId, undefined) ?? room.pictureStore;
    $: status = partnerStatus(partner.place, $LL);
    $: live = isInUniverse(partner.place);
    $: canViewProfile = canOpenPartnerProfile(partner);
    $: tiles = [partner.actions.walkTo, partner.actions.locate, canViewProfile].filter(Boolean).length;

    function toggleMute() {
        const change = $areNotificationsMuted ? room.unmuteNotification() : room.muteNotification();
        change.catch((error) => console.error("Failed to change the chat's notifications", error));
    }

    function toggleBlock() {
        if (blockInProgress) return;
        blockInProgress = true;
        setPartnerBlocked(partner, !partner.isBlocked)
            .catch((error) => console.error("Failed to change the block", error))
            .finally(() => (blockInProgress = false));
    }

    function deleteChat() {
        room.leaveRoom()
            .then(() => {
                dispatch("close");
                if ($selectedRoomStore?.id === room.id) selectedRoomStore.set(undefined);
                notificationPlayingStore.playNotification($LL.chat.directChat.deleteChat.notification());
            })
            .catch((error) => console.error("Failed to delete the chat", error));
    }
</script>

<div class="partner-profile absolute inset-0 z-[100] flex flex-col" data-testid="partnerProfilePanel">
    <div class="p-2 flex items-center gap-1 border border-solid border-x-0 border-b border-t-0 border-white/10">
        <button
            type="button"
            class="p-3 text-white hover:bg-white/10 rounded-2xl aspect-square w-12"
            data-testid="partnerProfileBack"
            aria-label={$LL.chat.directChat.profile.title()}
            on:click={() => dispatch("close")}
        >
            {#if direction === "rtl"}
                <IconChevronRight font-size="20" />
            {:else}
                <IconChevronLeft font-size="20" />
            {/if}
        </button>
        <div class="px-2 text-md font-bold">{$LL.chat.directChat.profile.title()}</div>
    </div>

    <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <div class="flex flex-col items-center gap-1.5 pt-1 text-center">
            <div class="relative mb-1.5">
                <TopRowAvatar
                    pictureStore={picture}
                    name={$roomName}
                    color={$colourOf(partner.chatId, $roomName)}
                    size="xl"
                    ring={false}
                />
                {#if live}
                    <span
                        class="absolute -inset-1.5 rounded-full border-2 border-solid"
                        style:border-color={status.color}
                    />
                {/if}
                {#if status.color}
                    <span
                        class="partner-presence absolute bottom-0.5 end-0.5 h-[18px] w-[18px] rounded-full"
                        style:background-color={status.color}
                    />
                {/if}
            </div>
            <div class="max-w-full break-words text-lg font-bold leading-6" data-testid="partnerProfileName">
                {$roomName}
            </div>
            <div class="flex max-w-full items-center gap-1.5 text-xs text-white/60" data-testid="partnerProfileStatus">
                <span
                    class="h-1.5 w-1.5 shrink-0 rounded-full"
                    style:background-color={status.color ?? "rgb(255 255 255 / 0.35)"}
                />
                <span class="truncate">{status.label}</span>
            </div>
        </div>

        {#if partner.user?.visitCardUrl && !partner.isBot}
            <VisitCard visitCardUrl={partner.user.visitCardUrl} isEmbedded={true} showSendMessageButton={false} />
        {/if}

        {#if tiles > 0}
            <div class="grid gap-2" style:grid-template-columns="repeat({tiles}, minmax(0, 1fr))">
                {#if partner.actions.walkTo}
                    <button type="button" class="partner-tile" on:click={() => walkToPartner(partner)}>
                        <span class="partner-tile-icon"><IconWalk font-size="20" /></span>
                        {$LL.chat.userList.walkTo()}
                    </button>
                {/if}
                {#if partner.actions.locate}
                    <button type="button" class="partner-tile" on:click={() => locatePartner(partner, $roomName)}>
                        <span class="partner-tile-icon"><IconMapPin font-size="20" /></span>
                        {$LL.chat.userList.follow()}
                    </button>
                {/if}
                {#if canViewProfile}
                    <button
                        type="button"
                        class="partner-tile"
                        data-testid="partnerFullProfile"
                        on:click={() => openPartnerProfile(partner)}
                    >
                        <span class="partner-tile-icon"><IconUserCircle font-size="20" /></span>
                        {$LL.chat.directChat.profile.fullProfile()}
                    </button>
                {/if}
            </div>
        {/if}

        <div class="partner-group">
            <button
                type="button"
                class="u-menu-row !m-0"
                role="switch"
                aria-checked={$areNotificationsMuted}
                data-testid="partnerMuteToggle"
                on:click={toggleMute}
            >
                <span class="u-menu-tile"><IconMute /></span>
                <span class="u-menu-label">{$LL.chat.directChat.muteNotifications()}</span>
                <span class="partner-switch" class:partner-switch-on={$areNotificationsMuted} aria-hidden="true" />
            </button>
        </div>

        <div class="partner-group">
            {#if !partner.isBot && partner.chatId}
                <button
                    type="button"
                    class="u-menu-row u-danger !m-0"
                    data-testid="partnerBlock"
                    disabled={blockInProgress}
                    on:click={toggleBlock}
                >
                    <span class="u-menu-tile"><IconBan /></span>
                    <span class="flex min-w-0 flex-1 flex-col">
                        <span class="truncate"
                            >{partner.isBlocked
                                ? $LL.chat.directChat.profile.unblock({ name: $roomName })
                                : $LL.chat.directChat.profile.block({ name: $roomName })}</span
                        >
                        <span class="partner-hint"
                            >{partner.isBlocked
                                ? $LL.chat.directChat.profile.unblockHint()
                                : $LL.chat.directChat.profile.blockHint()}</span
                        >
                    </span>
                </button>
            {/if}
            {#if canReportPartner(partner)}
                <button
                    type="button"
                    class="u-menu-row u-danger !m-0"
                    data-testid="partnerReport"
                    on:click={() => reportPartner(partner, $roomName)}
                >
                    <span class="u-menu-tile"><IconFlag /></span>
                    <span class="flex min-w-0 flex-1 flex-col">
                        <span class="truncate">{$LL.chat.directChat.profile.report({ name: $roomName })}</span>
                        <span class="partner-hint">{$LL.chat.directChat.profile.reportHint()}</span>
                    </span>
                </button>
            {/if}
            {#if confirmingDelete}
                <div class="flex flex-col gap-2 p-2 text-sm" data-testid="partnerDeleteConfirm">
                    <span class="font-bold">{$LL.chat.directChat.deleteChat.confirm()}</span>
                    <span class="text-xs text-white/60">{$LL.chat.directChat.deleteChat.hint({ name: $roomName })}</span
                    >
                    <div class="flex gap-2">
                        <button
                            type="button"
                            class="m-0 flex-1 rounded-lg bg-white/10 px-2 py-2 text-sm text-white [font-family:inherit] hover:bg-white/20"
                            on:click={() => (confirmingDelete = false)}
                            >{$LL.chat.directChat.deleteChat.cancel()}</button
                        >
                        <button
                            type="button"
                            class="m-0 flex-1 rounded-lg bg-danger-900 px-2 py-2 text-sm font-bold text-white [font-family:inherit] hover:bg-danger"
                            data-testid="partnerDeleteConfirmButton"
                            on:click={deleteChat}>{$LL.chat.directChat.deleteChat.confirmButton()}</button
                        >
                    </div>
                </div>
            {:else}
                <button
                    type="button"
                    class="u-menu-row u-danger !m-0"
                    data-testid="partnerDeleteChat"
                    on:click={() => (confirmingDelete = true)}
                >
                    <span class="u-menu-tile"><IconTrash /></span>
                    <span class="flex min-w-0 flex-1 flex-col">
                        <span class="truncate">{$LL.chat.directChat.deleteChat.label()}</span>
                        <span class="partner-hint">{$LL.chat.directChat.deleteChat.hint({ name: $roomName })}</span>
                    </span>
                </button>
            {/if}
        </div>
    </div>
</div>

<style lang="scss">
    .partner-presence {
        border: 3px solid rgb(var(--u-ink));
    }
    .partner-tile {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.4rem;
        margin: 0;
        padding: 0.65rem 0.25rem 0.6rem;
        border-radius: 14px;
        font-family: inherit;
        font-size: 0.8rem;
        font-weight: 600;
        color: #fff;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.12);
        transition: background-color 150ms ease, border-color 150ms ease;
    }
    .partner-tile:hover {
        background: rgba(255, 255, 255, 0.12);
        border-color: rgba(255, 255, 255, 0.24);
    }
    .partner-tile:focus-visible {
        outline: 2px solid rgba(196, 181, 253, 0.9);
        outline-offset: 2px;
    }
    .partner-tile-icon {
        display: grid;
        place-items: center;
        width: 2.25rem;
        height: 2.25rem;
    }
    .partner-group {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 4px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.08);
    }
    .partner-hint {
        font-size: 0.72rem;
        font-weight: 400;
        line-height: 1rem;
        color: rgba(255, 255, 255, 0.45);
        white-space: normal;
    }
    .partner-switch {
        position: relative;
        flex: none;
        width: 38px;
        height: 22px;
        margin-inline-start: auto;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.18);
        transition: background-color 150ms ease;
    }
    .partner-switch::after {
        content: "";
        position: absolute;
        top: 3px;
        inset-inline-start: 3px;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: #fff;
        transition: transform 150ms ease;
    }
    .partner-switch-on {
        background: linear-gradient(90deg, #8629fc, #4156f6);
    }
    .partner-switch-on::after {
        transform: translateX(16px);
    }
    :global([dir="rtl"]) .partner-switch-on::after {
        transform: translateX(-16px);
    }
</style>
