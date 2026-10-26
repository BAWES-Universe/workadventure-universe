<script lang="ts">
    import { derived } from "svelte/store";
    import { openModal } from "svelte-modals";
    import LL from "../../../../../i18n/i18n-svelte";
    import type { MatrixChatRoom } from "../../../Connection/Matrix/MatrixChatRoom";
    import { notificationPlayingStore } from "../../../../Stores/NotificationStore";
    import { selectedRoomStore } from "../../../Stores/SelectRoomStore";
    import { openRoomDetailsIdStore } from "../../../Stores/ChatDetailsStore";
    import TopRowAvatar from "../../TopRow/TopRowAvatar.svelte";
    import ManageParticipantsModal from "../ManageParticipantsModal.svelte";
    import SharedSummary from "./SharedSummary.svelte";
    import PinnedSummary from "./PinnedSummary.svelte";
    import MemberRow from "./MemberRow.svelte";
    import { IconChevronLeft, IconChevronRight, IconLogout, IconMute, IconUserEdit } from "@wa-icons";

    /**
     * A group's details, over the conversation: its picture and name, what it shared, who is in it, and the group's
     * own settings (participants, mute, leave), the same ones as its "…" menu. Back returns to the conversation.
     */
    export let room: MatrixChatRoom;

    const roomName = room.name;
    const members = room.members;
    const areNotificationsMuted = room.areNotificationsMuted;
    const hasPermissionToInvite = room.hasPermissionTo("invite");
    const hasPermissionToKick = room.hasPermissionTo("kick");
    const hasPermissionToBan = room.hasPermissionTo("ban");
    const direction = document.documentElement.getAttribute("dir") || "ltr";
    const currentMember = room.currentRoomMember;

    // The people in the group now (an invite or someone who left is in Participants), you first.
    $: joinedStore = derived(
        $members.map((member) => member.membership),
        (memberships) => $members.filter((_, index) => memberships[index] === "join")
    );
    $: joined = $joinedStore;
    $: myId = $currentMember?.id;
    $: people = [...joined].sort((a, b) => Number(b.id === myId) - Number(a.id === myId));

    $: canManageParticipants = $hasPermissionToInvite || $hasPermissionToKick || $hasPermissionToBan;

    function close() {
        openRoomDetailsIdStore.set(undefined);
    }

    function toggleMute() {
        const change = $areNotificationsMuted ? room.unmuteNotification() : room.muteNotification();
        change.catch((error) => console.error("Failed to change the group's notifications", error));
    }

    function leave() {
        room.leaveRoom()
            .then(() => {
                close();
                if ($selectedRoomStore?.id === room.id) selectedRoomStore.set(undefined);
                notificationPlayingStore.playNotification($LL.chat.roomMenu.leaveRoom.notification());
            })
            .catch((error) => console.error("Failed to leave the group", error));
    }
</script>

<div class="room-details absolute inset-0 z-[100] flex flex-col" data-testid="roomDetailsPanel">
    <div class="p-2 flex items-center gap-1 border border-solid border-x-0 border-b border-t-0 border-white/10">
        <button
            type="button"
            class="p-3 text-white hover:bg-white/10 rounded-2xl aspect-square w-12 shrink-0"
            data-testid="roomDetailsBack"
            aria-label={$LL.chat.details.title()}
            on:click={close}
        >
            {#if direction === "rtl"}
                <IconChevronRight font-size="20" />
            {:else}
                <IconChevronLeft font-size="20" />
            {/if}
        </button>
        <div class="px-2 text-md font-bold">{$LL.chat.details.title()}</div>
    </div>

    <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <div class="flex flex-col items-center gap-1.5 pt-1 text-center">
            <div class="mb-1.5">
                <TopRowAvatar pictureStore={room.pictureStore} name={$roomName} size="xl" ring={false} />
            </div>
            <div class="max-w-full break-words text-lg font-bold leading-6" data-testid="roomDetailsName">
                {$roomName}
            </div>
            <div class="text-xs text-white/60">{$LL.chat.directChat.members({ count: joined.length })}</div>
        </div>

        <PinnedSummary {room} />
        <SharedSummary {room} />

        <div class="details-group" data-testid="roomDetailsPeople">
            <div class="details-heading">{$LL.chat.details.people()} · {joined.length}</div>
            {#each people as member (member.id)}
                <MemberRow {member} isMe={member.id === myId} />
            {/each}
        </div>

        <div class="details-group">
            {#if canManageParticipants}
                <button
                    type="button"
                    class="u-menu-row !m-0"
                    data-testid="roomDetailsParticipants"
                    on:click={() => openModal(ManageParticipantsModal, { room })}
                >
                    <span class="u-menu-tile"><IconUserEdit /></span>
                    <span class="u-menu-label">{$LL.chat.manageRoomUsers.roomOption()}</span>
                </button>
            {/if}
            <button
                type="button"
                class="u-menu-row !m-0"
                role="switch"
                aria-checked={$areNotificationsMuted}
                data-testid="roomDetailsMute"
                on:click={toggleMute}
            >
                <span class="u-menu-tile"><IconMute /></span>
                <span class="u-menu-label">{$LL.chat.roomMenu.muteRoom()}</span>
                <span class="details-switch" class:details-switch-on={$areNotificationsMuted} aria-hidden="true" />
            </button>
        </div>

        <div class="details-group">
            <button type="button" class="u-menu-row u-danger !m-0" data-testid="roomDetailsLeave" on:click={leave}>
                <span class="u-menu-tile"><IconLogout /></span>
                <span class="truncate">{$LL.chat.roomMenu.leaveRoom.label()}</span>
            </button>
        </div>
    </div>
</div>

<style>
    .details-group {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 4px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.08);
    }
    .details-heading {
        padding: 0.4rem 0.5rem 0.2rem;
        font-size: 0.72rem;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.55);
    }
    /* The same switch as Mute notifications in a direct chat's Profile. */
    .details-switch {
        position: relative;
        flex: none;
        width: 38px;
        height: 22px;
        margin-inline-start: auto;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.18);
        transition: background-color 150ms ease;
    }
    .details-switch::after {
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
    .details-switch-on {
        background: linear-gradient(90deg, #8629fc, #4156f6);
    }
    .details-switch-on::after {
        transform: translateX(16px);
    }
    :global([dir="rtl"]) .details-switch-on::after {
        transform: translateX(-16px);
    }
</style>
