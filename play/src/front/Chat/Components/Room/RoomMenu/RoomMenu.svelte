<script lang="ts">
    import { getContext, hasContext, onDestroy, onMount } from "svelte";
    import { get, readable } from "svelte/store";
    import type { Readable } from "svelte/store";
    import { openModal } from "svelte-modals";
    import type {
        ChatRoomMembershipManagement,
        ChatRoomNotificationControl,
        ChatRoomModeration,
        ChatRoom,
    } from "../../../Connection/ChatConnection";
    import { showChatDoneToast } from "../../../../Stores/ChatDoneToastStore";
    import { warningMessageStore } from "../../../../Stores/ErrorStore";
    import { localUserStore } from "../../../../Connection/LocalUserStore";
    import LL from "../../../../../i18n/i18n-svelte";
    import ManageParticipantsModal from "../ManageParticipantsModal.svelte";
    import type { OrderFreeze } from "../../OneList/OneListStore";
    import { ONE_LIST_FREEZE_CONTEXT } from "../../OneList/OneListStore";
    import { openChatMenuStore } from "../../../Stores/OpenChatMenuStore";
    import { selectedRoomStore } from "../../../Stores/SelectRoomStore";
    import { openProfileRoomIdStore } from "../../../Stores/PartnerProfileStore";
    import { friendsEnabledStore, relationshipsStore } from "../../../Stores/FriendsStore";
    import { invitesEnabledStore } from "../../../Stores/RingStore";
    import { NAME_BY_CHAT_ID_CONTEXT, personName } from "../../../Stores/ChatUserWokaStore";
    import { botIdFromChatId } from "../../../Bots/BotChatStatus";
    import MemorySheet from "../../../Bricks/MemorySheet.svelte";
    import { openBrickChat } from "../../../Bricks/BrickChat";
    import { loadMyBricks, myBricksStore } from "../../../Bricks/MyBricksStore";
    import { directPartnerStore } from "../DirectChat/DirectPartnerStore";
    import { partnerStillInChat } from "../DirectChat/partnerStillInChat";
    import {
        canInvitePartner,
        canOpenPartnerProfile,
        invitePartner,
        isBotPartner,
        locatePartner,
        openPartnerProfile,
        partnerFriendAction,
        walkToPartner,
    } from "../DirectChat/PartnerActions";
    import RoomOption from "./RoomOption.svelte";
    import {
        IconDots,
        IconLogout,
        IconUserEdit,
        IconMute,
        IconUnMute,
        IconMapPin,
        IconWalk,
        IconRotate,
        IconTrash,
        IconUserCircle,
        IconUsersPlus,
        IconBrain,
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
    // The delete text differs once the other person has already deleted the chat.
    const partnerHolds = partnerStillInChat(room.members, localUserStore.getChatId());

    // The name they go by now, like the chat's header and profile: the room keeps the name it had when it was made.
    const nameByChatId: Readable<Map<string, string>> = hasContext(NAME_BY_CHAT_ID_CONTEXT)
        ? getContext(NAME_BY_CHAT_ID_CONTEXT)
        : readable(new Map<string, string>());
    $: name = personName($nameByChatId, $partner?.chatId, $roomName);

    // Invite and Add friend need the person's account, which the chat finds even when they're in another world.
    $: canInvite = $partner ? canInvitePartner($partner, $invitesEnabledStore) : false;
    $: friendAction = $partner
        ? partnerFriendAction($partner, name, $friendsEnabledStore, $relationshipsStore, $LL)
        : undefined;

    // Inside the one chat list, the list holds its order still while this menu is open.
    const orderFreeze = getContext<OrderFreeze | undefined>(ONE_LIST_FREEZE_CONTEXT);
    const freezeHolder = {};
    $: orderFreeze?.setHeld(freezeHolder, !hideOptions);
    $: if (hideOptions) confirmingDelete = false;

    // A direct chat always has the same two people: Participants is for groups only.
    $: shouldDisplayManageParticipantButton =
        !isDirect && ($hasPermissionToInvite || $hasPermissionToKick || $hasPermissionToBan);

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

    // A chat with a Brick (anyone's) is cleared, not deleted: it starts again empty, and the Brick keeps what it learned
    $: clearsChat = $partner !== undefined && isBotPartner($partner);

    /**
     * Whether a bot's chat is with one of the person's own Bricks. When Orbit has not been asked yet it is asked before the
     * chat is cleared: not knowing the Bricks is not knowing the bot is someone else's. When Orbit does not answer either, the
     * bot is not known to be theirs and the person is left on the list of chats, told that the chat was cleared.
     */
    async function ownBrickIdOf(botId: string | undefined): Promise<string | undefined> {
        if (!botId) return undefined;
        if (get(myBricksStore) === undefined) await loadMyBricks();
        return (get(myBricksStore) ?? []).some((brick) => brick.id === botId) ? botId : undefined;
    }

    function closeMenuAndLeaveRoom() {
        toggleRoomOptions();
        // Says which chat went: "Deleted your chat with Mishari", "Left Design team".
        const cleared = clearsChat;
        const botId = cleared ? memoryBotId : undefined;
        const notification = cleared
            ? $LL.chat.directChat.clearChat.notification({ name })
            : isDirect
            ? $LL.chat.directChat.deleteChat.notification({ name })
            : $LL.chat.roomMenu.leaveRoom.notification({ name });
        // Deleting a chat leaves it and forgets it, so it goes from the person's lists and not just from view.
        ownBrickIdOf(botId)
            .then((brickId) =>
                room.leaveRoom(isDirect ? { forget: true } : undefined).then(() => {
                    if ($selectedRoomStore?.id === room.id) selectedRoomStore.set(undefined);
                    showChatDoneToast(notification);
                    // The person's own Brick opens again as a new empty chat
                    if (brickId) openBrickChat(brickId).catch((error) => console.error(error));
                })
            )
            .catch((error) => {
                console.error("Failed to leave room", error);
                if (cleared) warningMessageStore.addWarningMessage($LL.chat.directChat.clearChat.failed());
                else if (isDirect) warningMessageStore.addWarningMessage($LL.chat.directChat.deleteChat.failed());
            });
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

    function invite() {
        if ($partner) invitePartner($partner, name);
        toggleRoomOptions();
    }

    function runFriendAction() {
        friendAction?.act();
        toggleRoomOptions();
    }

    function walkTo() {
        if ($partner) walkToPartner($partner);
        toggleRoomOptions();
    }

    function locate() {
        if ($partner) locatePartner($partner, name);
        toggleRoomOptions();
    }

    // What a bot remembers about this person (game #2003): in a chat with any bot, theirs or someone else's
    $: memoryBotId = isDirect && $partner && isBotPartner($partner) ? botIdFromChatId($partner.chatId) : undefined;

    function openMemory() {
        toggleRoomOptions();
        if (!memoryBotId) return;
        const own = ($myBricksStore ?? []).some((brick) => brick.id === memoryBotId);
        openModal(MemorySheet, { botId: memoryBotId, name, own });
    }

    // Their profile in Orbit, online or not (the same page as Full profile); the chat's own profile page only for
    // a bot, or when Orbit isn't available.
    function viewProfile() {
        toggleRoomOptions();
        if ($partner && canOpenPartnerProfile($partner)) {
            openPartnerProfile($partner);
            return;
        }
        selectedRoomStore.set(room);
        openProfileRoomIdStore.set(room.id);
    }
</script>

<button
    data-testid="toggleRoomMenu"
    bind:this={optionButtonRef}
    on:click|preventDefault|stopPropagation={toggleRoomOptions}
    class="m-0 p-0 flex items-center justify-center h-7 w-7 text-white hover:bg-white/10 rounded"
>
    <IconDots font-size="16" />
</button>
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
    on:mouseleave={() => (hideOptions = true)}
    class="u-surface rounded-2xl overflow-hidden z-[99] w-max min-w-48 end-2 p-1 {inHeader ? 'top-14' : 'top-10'}"
    class:absolute={optionButtonRef !== undefined}
    class:hidden={hideOptions}
    data-testid="roomMenu"
>
    {#if isDirect}
        {#if canInvite}
            <RoomOption
                dataTestId="inviteOption"
                IconComponent={IconUsersPlus}
                title={$LL.chat.friends.ring.ring()}
                on:click={invite}
            />
        {/if}
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
        {#if friendAction && !friendAction.danger}
            <RoomOption
                dataTestId="friendActionOption"
                IconComponent={friendAction.icon}
                title={friendAction.label}
                on:click={runFriendAction}
            />
        {/if}
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

    {#if memoryBotId}
        <RoomOption
            dataTestId="botMemoryOption"
            IconComponent={IconBrain}
            title={$LL.chat.brick.memory.menu({ name })}
            on:click={openMemory}
        />
    {/if}

    {#if isDirect}
        <div class="u-menu-divider" />
        {#if friendAction?.danger}
            <RoomOption
                dataTestId="friendActionOption"
                IconComponent={friendAction.icon}
                title={friendAction.label}
                bg="u-danger"
                on:click={runFriendAction}
            />
        {/if}
        {#if confirmingDelete}
            <div class="flex flex-col gap-2 p-2 text-sm" data-testid="deleteChatConfirm">
                <span class="font-bold"
                    >{clearsChat
                        ? $LL.chat.directChat.clearChat.confirm()
                        : $LL.chat.directChat.deleteChat.confirm()}</span
                >
                <span class="max-w-56 text-xs text-white/60"
                    >{clearsChat
                        ? $LL.chat.directChat.clearChat.confirmHint({ name })
                        : $partnerHolds
                        ? $LL.chat.directChat.deleteChat.hint({ name })
                        : $LL.chat.directChat.deleteChat.hintGone({ name })}</span
                >
                <div class="flex gap-2">
                    <button
                        type="button"
                        class="m-0 flex-1 rounded bg-white/10 px-2 py-1.5 text-sm text-white [font-family:inherit] hover:bg-white/20"
                        on:click|stopPropagation={() => (confirmingDelete = false)}
                        >{$LL.chat.directChat.deleteChat.cancel()}</button
                    >
                    <button
                        type="button"
                        class="m-0 flex-1 rounded bg-danger-900 px-2 py-1.5 text-sm font-bold text-white [font-family:inherit] hover:bg-danger"
                        data-testid="deleteChatConfirmButton"
                        on:click|stopPropagation={closeMenuAndLeaveRoom}
                        >{clearsChat
                            ? $LL.chat.directChat.clearChat.confirmButton()
                            : $LL.chat.directChat.deleteChat.confirmButton()}</button
                    >
                </div>
            </div>
        {:else}
            <RoomOption
                dataTestId="deleteChatOption"
                IconComponent={clearsChat ? IconRotate : IconTrash}
                title={clearsChat ? $LL.chat.directChat.clearChat.label() : $LL.chat.directChat.deleteChat.label()}
                bg="u-danger"
                on:click={() => (confirmingDelete = true)}
            />
        {/if}
    {:else}
        <RoomOption
            dataTestId="leaveGroupOption"
            IconComponent={IconLogout}
            title={$LL.chat.roomMenu.leaveRoom.label()}
            bg="bg-danger-900 hover:bg-danger"
            on:click={closeMenuAndLeaveRoom}
        />
    {/if}
</div>
