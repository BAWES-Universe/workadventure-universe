<script lang="ts">
    import { getContext, onDestroy, onMount } from "svelte";
    import { openModal } from "svelte-modals";
    import type {
        ChatRoomMembershipManagement,
        ChatRoomNotificationControl,
        ChatRoomModeration,
        ChatRoom,
    } from "../../../Connection/ChatConnection";
    import { notificationPlayingStore } from "../../../../Stores/NotificationStore";
    import LL from "../../../../../i18n/i18n-svelte";
    import ManageParticipantsModal from "../ManageParticipantsModal.svelte";
    import type { OrderFreeze } from "../../OneList/OneListStore";
    import { ONE_LIST_FREEZE_CONTEXT } from "../../OneList/OneListStore";
    import { openChatMenuStore } from "../../../Stores/OpenChatMenuStore";
    import { selectedRoomStore } from "../../../Stores/SelectRoomStore";
    import { openProfileRoomIdStore } from "../../../Stores/PartnerProfileStore";
    import { directPartnerStore } from "../DirectChat/DirectPartnerStore";
    import { locatePartner, walkToPartner } from "../DirectChat/PartnerActions";
    import RoomOption from "./RoomOption.svelte";
    import {
        IconDots,
        IconLogout,
        IconUserEdit,
        IconMute,
        IconUnMute,
        IconMapPin,
        IconWalk,
        IconTrash,
        IconUserCircle,
    } from "@wa-icons";

    export let room: ChatRoom & ChatRoomMembershipManagement & ChatRoomNotificationControl & ChatRoomModeration;
    /** In the chat header, which is taller than a list row: the menu opens below it, clear of the status line. */
    export let inHeader = false;
    const areNotificationsMuted = room.areNotificationsMuted;
    const roomName = room.name;
    let optionButtonRef: HTMLButtonElement | undefined = undefined;
    let hideOptions = true;
    let confirmingDelete = false;

    const hasPermissionToInvite = room.hasPermissionTo("invite");
    const hasPermissionToKick = room.hasPermissionTo("kick");
    const hasPermissionToBan = room.hasPermissionTo("ban");

    // A direct chat offers what works with that person right now: Walk to and Locate only when they can work.
    const isDirect = room.type === "direct";
    const partner = isDirect ? directPartnerStore(room) : undefined;

    // Inside the one chat list, the list holds its order still while this menu is open.
    const orderFreeze = getContext<OrderFreeze | undefined>(ONE_LIST_FREEZE_CONTEXT);
    const freezeHolder = {};
    $: orderFreeze?.setHeld(freezeHolder, !hideOptions);
    $: if (hideOptions) confirmingDelete = false;

    $: shouldDisplayManageParticipantButton = $hasPermissionToInvite || $hasPermissionToKick || $hasPermissionToBan;

    // Opening another chat menu closes this one.
    const unsubscribeOpenMenu = openChatMenuStore.subscribe((openMenu) => {
        if (openMenu !== freezeHolder) hideOptions = true;
    });

    onMount(() => {
        document.addEventListener("click", closeRoomOptionsOnClickOutside);
    });

    onDestroy(() => {
        document.removeEventListener("click", closeRoomOptionsOnClickOutside);
        orderFreeze?.release(freezeHolder);
        unsubscribeOpenMenu();
        openChatMenuStore.update((openMenu) => (openMenu === freezeHolder ? undefined : openMenu));
    });

    function toggleRoomOptions() {
        if (optionButtonRef === undefined) {
            return;
        }
        hideOptions = !hideOptions;
        if (!hideOptions) openChatMenuStore.set(freezeHolder);
    }

    function closeRoomOptionsOnClickOutside(e: MouseEvent) {
        if (optionButtonRef === undefined) {
            return;
        }
        if (e.target instanceof HTMLElement && !optionButtonRef.contains(e.target)) {
            hideOptions = true;
        }
    }

    function closeMenuAndLeaveRoom() {
        toggleRoomOptions();
        const notification = isDirect
            ? $LL.chat.directChat.deleteChat.notification()
            : $LL.chat.roomMenu.leaveRoom.notification();
        room.leaveRoom()
            .then(() => {
                if ($selectedRoomStore?.id === room.id) selectedRoomStore.set(undefined);
                notificationPlayingStore.playNotification(notification);
            })
            .catch(() => console.error("Failed to leave room"));
    }

    function openManageParticipantsModal() {
        openModal(ManageParticipantsModal, { room });
    }

    function closeMenuAndSetMuteStatus() {
        toggleRoomOptions();
        if ($areNotificationsMuted) {
            room.unmuteNotification().catch(() => {
                console.error("Failed to unmute room");
            });
            return;
        }
        room.muteNotification().catch(() => {
            console.error("Failed to mute room");
        });
    }

    function walkTo() {
        if ($partner) walkToPartner($partner);
        toggleRoomOptions();
    }

    function locate() {
        if ($partner) locatePartner($partner, $roomName);
        toggleRoomOptions();
    }

    function viewProfile() {
        toggleRoomOptions();
        selectedRoomStore.set(room);
        openProfileRoomIdStore.set(room.id);
    }
</script>

<button
    data-testid="toggleRoomMenu"
    bind:this={optionButtonRef}
    on:click|preventDefault|stopPropagation={toggleRoomOptions}
    class="m-0 p-0 flex items-center justify-center h-7 w-7 hover:bg-white/10 rounded"
>
    <IconDots font-size="16" />
</button>
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
    on:mouseleave={toggleRoomOptions}
    class="bg-contrast/50 backdrop-blur-md rounded-md overflow-hidden z-[99] w-max min-w-48 end-2 p-1 {inHeader
        ? 'top-14'
        : 'top-10'}"
    class:absolute={optionButtonRef !== undefined}
    class:hidden={hideOptions}
    data-testid="roomMenu"
>
    {#if isDirect}
        {#if $partner?.actions.walkTo}
            <RoomOption IconComponent={IconWalk} title={$LL.chat.userList.walkTo()} on:click={walkTo} />
        {/if}
        {#if $partner?.actions.locate}
            <RoomOption IconComponent={IconMapPin} title={$LL.chat.userList.follow()} on:click={locate} />
        {/if}
        <RoomOption
            dataTestId="viewProfileOption"
            IconComponent={IconUserCircle}
            title={$LL.chat.userList.viewProfile()}
            on:click={viewProfile}
        />
    {/if}
    {#if shouldDisplayManageParticipantButton}
        <RoomOption
            dataTestId="manageParticipantOption"
            IconComponent={IconUserEdit}
            title={$LL.chat.manageRoomUsers.roomOption()}
            on:click={openManageParticipantsModal}
        />
    {/if}

    <RoomOption
        IconComponent={$areNotificationsMuted ? IconUnMute : IconMute}
        title={isDirect
            ? $areNotificationsMuted
                ? $LL.chat.directChat.unmuteNotifications()
                : $LL.chat.directChat.muteNotifications()
            : $areNotificationsMuted
            ? $LL.chat.roomMenu.unmuteRoom()
            : $LL.chat.roomMenu.muteRoom()}
        on:click={closeMenuAndSetMuteStatus}
    />

    {#if isDirect}
        <div class="my-1 h-px bg-white/10" />
        {#if confirmingDelete}
            <div class="flex flex-col gap-2 p-2 text-sm" data-testid="deleteChatConfirm">
                <span class="font-bold">{$LL.chat.directChat.deleteChat.confirm()}</span>
                <span class="max-w-56 text-xs text-white/60">{$LL.chat.directChat.deleteChat.hint()}</span>
                <div class="flex gap-2">
                    <button
                        type="button"
                        class="m-0 flex-1 rounded bg-white/10 px-2 py-1.5 text-sm hover:bg-white/20"
                        on:click|stopPropagation={() => (confirmingDelete = false)}
                        >{$LL.chat.directChat.deleteChat.cancel()}</button
                    >
                    <button
                        type="button"
                        class="m-0 flex-1 rounded bg-danger-900 px-2 py-1.5 text-sm font-bold hover:bg-danger"
                        data-testid="deleteChatConfirmButton"
                        on:click|stopPropagation={closeMenuAndLeaveRoom}
                        >{$LL.chat.directChat.deleteChat.confirmButton()}</button
                    >
                </div>
            </div>
        {:else}
            <RoomOption
                dataTestId="deleteChatOption"
                IconComponent={IconTrash}
                title={$LL.chat.directChat.deleteChat.label()}
                bg="text-[#f08a70] hover:bg-danger-900/40"
                on:click={() => (confirmingDelete = true)}
            />
        {/if}
    {:else}
        <RoomOption
            IconComponent={IconLogout}
            title={$LL.chat.roomMenu.leaveRoom.label()}
            bg="bg-danger-900 hover:bg-danger"
            on:click={closeMenuAndLeaveRoom}
        />
    {/if}
</div>
