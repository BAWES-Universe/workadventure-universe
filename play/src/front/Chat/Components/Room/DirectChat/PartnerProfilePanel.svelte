<script lang="ts">
    import { createEventDispatcher, getContext, hasContext } from "svelte";
    import { get, readable } from "svelte/store";
    import type { Readable } from "svelte/store";
    import LL from "../../../../../i18n/i18n-svelte";
    import type {
        ChatRoom,
        ChatRoomMembershipManagement,
        ChatRoomNotificationControl,
    } from "../../../Connection/ChatConnection";
    import type { PictureStore } from "../../../../Stores/PictureStore";
    import { showChatDoneToast } from "../../../../Stores/ChatDoneToastStore";
    import { warningMessageStore } from "../../../../Stores/ErrorStore";
    import { localUserStore } from "../../../../Connection/LocalUserStore";
    import {
        NAME_BY_CHAT_ID_CONTEXT,
        PERSON_COLOUR_CONTEXT,
        WOKA_BY_CHAT_ID_CONTEXT,
        personName,
        personPicture,
    } from "../../../Stores/ChatUserWokaStore";
    import { requestChatPerson } from "../../../Stores/ChatPeopleLookup";
    import type { PersonColourOf } from "../../../Stores/ChatUserWokaStore";
    import { selectedRoomStore } from "../../../Stores/SelectRoomStore";
    import { friendsEnabledStore, relationshipsStore } from "../../../Stores/FriendsStore";
    import { invitesEnabledStore } from "../../../Stores/RingStore";
    import TopRowAvatar from "../../TopRow/TopRowAvatar.svelte";
    import VisitCard from "../../../../Components/VisitCard/VisitCard.svelte";
    import SharedSummary from "../Details/SharedSummary.svelte";
    import ArtifactsSummary from "../Details/ArtifactsSummary.svelte";
    import PinnedSummary from "../Details/PinnedSummary.svelte";
    import { gameSceneStore } from "../../../../Stores/GameSceneStore";
    import { botApiService } from "../../../../external-modules/bots/services/BotApiService";
    import { botHomeRoom } from "../../../Bots/BotHomeRoom";
    import { visitBotRoom } from "../../../Bots/visitBotRoom";
    import { profileStatusLine } from "../../Status/ChatStatus";
    import type { ChatStatusFacts } from "../../Status/ChatStatus";
    import type { BotAvailability } from "../../../Bots/BotChatStatus";
    import BrickPicture from "../../../Bricks/BrickPicture.svelte";
    import BrickVisitCard from "../../../Bricks/BrickVisitCard.svelte";
    import { openBrickChat } from "../../../Bricks/BrickChat";
    import { loadMyBricks, myBricksByChatId, myBricksStore } from "../../../Bricks/MyBricksStore";
    import { openBrickPage } from "../../../Bricks/Templates/OpenBrick";
    import PartnerRoomBlock from "./PartnerRoomBlock.svelte";
    import { partnerNowIn, sameRoom, visitPerson } from "./PartnerNowIn";
    import type { DirectPartner } from "./DirectPartnerStore";
    import { isInUniverse } from "./PartnerPlace";
    import { partnerStillInChat } from "./partnerStillInChat";
    import {
        canBlockPartner,
        canInvitePartner,
        canOpenPartnerProfile,
        canReportPartner,
        invitePartner,
        isBotPartner,
        locatePartner,
        openPartnerProfile,
        partnerFriendAction,
        reportPartner,
        setPartnerBlocked,
        walkToPartner,
    } from "./PartnerActions";
    import {
        IconAdjustmentsHorizontal,
        IconBan,
        IconChevronLeft,
        IconChevronRight,
        IconFlag,
        IconMapPin,
        IconMute,
        IconRotate,
        IconTrash,
        IconUserCircle,
        IconUsersPlus,
        IconWalk,
    } from "@wa-icons";

    /**
     * Who you're chatting with, over the conversation: their woka and where they are, quick ways to reach them,
     * their profile card, what the chat shared, mute, and the safety actions at the bottom. Back returns to the conversation.
     */
    export let room: ChatRoom & ChatRoomMembershipManagement & ChatRoomNotificationControl;
    export let partner: DirectPartner;
    /** Set for a chat with a Brick or another bot: its state replaces where a person is, as in the chat header. */
    export let bot = false;
    export let botState: BotAvailability | undefined = undefined;
    /** The bot's state for the dot. It differs from the words only where the header stays quiet (someone with no access). */
    export let botDotState: BotAvailability | undefined = botState;

    const dispatch = createEventDispatcher<{ close: void }>();
    const roomName = room.name;
    const areNotificationsMuted = room.areNotificationsMuted;
    // The delete text differs once the other person has already deleted the chat.
    const partnerHolds = partnerStillInChat(room.members, localUserStore.getChatId());
    const direction = document.documentElement.getAttribute("dir") || "ltr";
    const wokaByChatId: Readable<Map<string, PictureStore>> = hasContext(WOKA_BY_CHAT_ID_CONTEXT)
        ? getContext(WOKA_BY_CHAT_ID_CONTEXT)
        : readable(new Map<string, PictureStore>());
    const nameByChatId: Readable<Map<string, string>> = hasContext(NAME_BY_CHAT_ID_CONTEXT)
        ? getContext(NAME_BY_CHAT_ID_CONTEXT)
        : readable(new Map<string, string>());
    const colourOf: Readable<PersonColourOf> = hasContext(PERSON_COLOUR_CONTEXT)
        ? getContext(PERSON_COLOUR_CONTEXT)
        : readable(() => undefined);

    // A bot shows where it lives, with Visit, so nobody has to ask it or scroll back for its room card.
    const botRoom = botHomeRoom(partner.chatId, (botId) => botApiService.getDmRoom(botId), window.location.origin);

    let confirmingDelete = false;
    let blockInProgress = false;

    // Someone outside the world is asked of Orbit (once), for their Woka and the name they go by.
    $: partnerChatId = partner.chatId;
    $: requestChatPerson(partnerChatId);
    $: name = personName($nameByChatId, partnerChatId, $roomName);
    $: picture = personPicture($wokaByChatId, partner.chatId, room.pictureStore);
    $: facts = (
        bot ? { kind: "bot", state: botDotState } : { kind: "person", place: partner.place }
    ) as ChatStatusFacts;
    $: status = profileStatusLine(facts, $LL, bot ? { words: botState } : undefined);
    $: live = !bot && isInUniverse(partner.place);
    // A Brick (the person's own, or someone else's) has no avatar in the world: it is known by its chat address
    $: isBrick = bot || isBotPartner(partner);
    // The person's own Brick: its look, its line, its visit card and its settings, as on its own page
    $: ownBrick = isBrick && partner.chatId ? $myBricksByChatId.get(partner.chatId) : undefined;
    $: canViewProfile = canOpenPartnerProfile(partner);
    $: canInvite = canInvitePartner(partner, $invitesEnabledStore);
    // A person shows where they are now, when they share their room with you and you can enter it (Orbit decides).
    // It comes after their bio and the buttons, so it doesn't push who they are down.
    $: partnerUuid = partner.isBot ? undefined : partner.uuid;
    $: personRoom = partnerNowIn(partnerUuid, () => botApiService.getLiveView(), window.location.origin);
    $: placeNow = $botRoom ?? $personRoom;
    $: currentRoomUrl = $gameSceneStore?.roomUrl;
    // Away from their room Visit already takes you to them, so Walk to would say the same thing twice.
    $: walkTo = partner.actions.walkTo && !(placeNow && !sameRoom(currentRoomUrl, placeNow.url));
    function visitRoom() {
        if ($botRoom) visitBotRoom($botRoom, partner, currentRoomUrl);
        else if ($personRoom) visitPerson(partner, $personRoom);
    }
    $: tiles = [canInvite, walkTo, partner.actions.locate, canViewProfile].filter(Boolean).length;
    // Add friend, or what comes next with them. Remove friend is red, so it sits with the other red rows.
    $: friendAction = partnerFriendAction(partner, name, $friendsEnabledStore, $relationshipsStore, $LL);
    $: friendRequestPossible = partner.uuid !== undefined && !$relationshipsStore.has(partner.uuid);

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

    /**
     * The id of the Brick when this chat is with one of the person's own. When Orbit has not been asked for their Bricks yet
     * it is asked before the chat is cleared: not knowing the Bricks is not knowing the Brick is someone else's. When Orbit
     * does not answer either, the Brick is not known to be theirs and the person is left on the list of chats.
     */
    async function ownBrickIdOf(chatId: string | undefined): Promise<string | undefined> {
        if (!chatId) return undefined;
        if (get(myBricksStore) === undefined) await loadMyBricks();
        return get(myBricksByChatId).get(chatId)?.id;
    }

    function deleteChat() {
        // The name as it is now: once the chat is gone the panel no longer knows it.
        const cleared = isBrick;
        const chatId = isBrick ? partner.chatId : undefined;
        const notification = cleared
            ? $LL.chat.directChat.clearChat.notification({ name })
            : $LL.chat.directChat.deleteChat.notification({ name });
        // Deleting a chat leaves it and forgets it, so it goes from the person's lists and not just from view. For a Brick
        // that is clearing it: its server starts a new, empty chat with the person's next message, and the Brick keeps what
        // it learned.
        ownBrickIdOf(chatId)
            .then((brickId) =>
                room.leaveRoom({ forget: true }).then(() => {
                    dispatch("close");
                    if ($selectedRoomStore?.id === room.id) selectedRoomStore.set(undefined);
                    showChatDoneToast(notification);
                    // The person's own Brick opens again at once, as a new empty chat. When its server is still dropping the old
                    // one it does not, and the person is left on the list of chats, told that the chat was cleared.
                    if (brickId) openBrickChat(brickId).catch((error) => console.error(error));
                })
            )
            .catch((error) => {
                console.error("Failed to delete the chat", error);
                warningMessageStore.addWarningMessage(
                    cleared ? $LL.chat.directChat.clearChat.failed() : $LL.chat.directChat.deleteChat.failed()
                );
            });
    }

    // Its Settings are its own page, which opens over the chat list; Back there returns to this chat
    function openSettings() {
        if (ownBrick) openBrickPage(ownBrick.id, { backToChat: true });
    }
</script>

<div
    class="partner-profile absolute inset-0 z-[100] flex flex-col"
    data-testid="partnerProfilePanel"
    data-chat-layer="panel"
>
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
        {#if isBrick}
            <!-- A Brick, drawn the way its own page draws it: its look, name and line, and the header's status word -->
            <div class="flex items-center gap-3.5" data-testid="partnerProfileIdentity">
                <div class="relative shrink-0">
                    {#if ownBrick}
                        <span class="partner-look" data-testid="partnerProfileLook">
                            <BrickPicture look={ownBrick.characterTextureId} size={46} />
                        </span>
                    {:else}
                        <TopRowAvatar
                            pictureStore={picture}
                            {name}
                            color={$colourOf(partner.chatId, name)}
                            size="lg"
                            ring={false}
                        />
                    {/if}
                    {#if status.color}
                        <span
                            class="partner-presence absolute bottom-0 end-0 h-[18px] w-[18px] rounded-full"
                            style:background-color={status.color}
                        />
                    {/if}
                </div>
                <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div class="break-words text-xl font-bold leading-6" data-testid="partnerProfileName">{name}</div>
                    {#if ownBrick?.description}
                        <div class="break-words text-[15px] leading-5 text-white/80" data-testid="partnerProfileLine">
                            {ownBrick.description}
                        </div>
                    {/if}
                    {#if status.label}
                        <div class="flex items-center gap-1.5 text-sm text-white/60" data-testid="partnerProfileStatus">
                            <span
                                class="h-2 w-2 shrink-0 rounded-full"
                                style:background-color={status.color ?? "rgb(255 255 255 / 0.35)"}
                            />
                            <span class="truncate">{status.label}</span>
                        </div>
                    {/if}
                </div>
            </div>

            {#if ownBrick}
                <!-- The same visit card as its own page, so Bring along and End visit are right here -->
                <BrickVisitCard brick={ownBrick} framed showOff />
            {/if}
        {:else}
            <div class="flex flex-col items-center gap-1.5 pt-1 text-center">
                <div class="relative mb-1.5">
                    <TopRowAvatar
                        pictureStore={picture}
                        {name}
                        color={$colourOf(partner.chatId, name)}
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
                    {name}
                </div>
                {#if status.label}
                    <div
                        class="flex max-w-full items-center gap-1.5 text-xs text-white/60"
                        data-testid="partnerProfileStatus"
                    >
                        <span
                            class="h-1.5 w-1.5 shrink-0 rounded-full"
                            style:background-color={status.color ?? "rgb(255 255 255 / 0.35)"}
                        />
                        <span class="truncate">{status.label}</span>
                    </div>
                {/if}
            </div>
        {/if}

        <!-- The person's own Brick says where it lives in its visit card (Take it out): the Visit block is for other Bricks -->
        {#if $botRoom && !ownBrick}
            <PartnerRoomBlock
                label={$LL.chat.botStatus.livesIn()}
                link={$botRoom}
                {name}
                {currentRoomUrl}
                visit={visitRoom}
            />
        {/if}

        {#if partner.user?.visitCardUrl && !partner.isBot}
            <VisitCard visitCardUrl={partner.user.visitCardUrl} isEmbedded={true} showSendMessageButton={false} />
        {/if}

        {#if tiles > 0}
            <div class="grid gap-2" style:grid-template-columns="repeat({tiles}, minmax(0, 1fr))">
                {#if canInvite}
                    <button
                        type="button"
                        class="partner-tile"
                        data-testid="partnerInvite"
                        on:click={() => invitePartner(partner, name)}
                    >
                        <span class="partner-tile-icon"><IconUsersPlus font-size="20" /></span>
                        {$LL.chat.friends.ring.ring()}
                    </button>
                {/if}
                {#if walkTo}
                    <button type="button" class="partner-tile" on:click={() => walkToPartner(partner)}>
                        <span class="partner-tile-icon"><IconWalk font-size="20" /></span>
                        {$LL.chat.userList.walkTo()}
                    </button>
                {/if}
                {#if partner.actions.locate}
                    <button type="button" class="partner-tile" on:click={() => locatePartner(partner, name)}>
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

        {#if !$botRoom && $personRoom}
            <PartnerRoomBlock
                label={$LL.chat.botStatus.nowIn()}
                link={$personRoom}
                {name}
                {currentRoomUrl}
                visit={visitRoom}
            />
        {/if}

        {#if ownBrick}
            <div class="partner-group">
                <button
                    type="button"
                    class="u-menu-row !m-0"
                    data-testid="partnerBrickSettings"
                    on:click={openSettings}
                >
                    <span class="u-menu-tile"><IconAdjustmentsHorizontal /></span>
                    <span class="flex min-w-0 flex-1 flex-col">
                        <span class="truncate">{$LL.chat.directChat.profile.settings()}</span>
                        <span class="partner-hint">{$LL.chat.directChat.profile.settingsHint()}</span>
                    </span>
                    {#if direction === "rtl"}
                        <IconChevronLeft font-size="18" />
                    {:else}
                        <IconChevronRight font-size="18" />
                    {/if}
                </button>
            </div>
        {/if}

        <PinnedSummary {room} />

        <ArtifactsSummary {room} botName={partner.isBot ? name : undefined} />

        <SharedSummary {room} />

        {#if friendAction && !friendAction.danger}
            <div class="partner-group">
                <button
                    type="button"
                    class="u-menu-row !m-0"
                    data-testid="partnerFriendAction"
                    on:click={friendAction.act}
                >
                    <span class="u-menu-tile"><svelte:component this={friendAction.icon} /></span>
                    <span class="flex min-w-0 flex-1 flex-col">
                        <span class="truncate">{friendAction.label}</span>
                        {#if friendRequestPossible}
                            <span class="partner-hint">{$LL.chat.friends.addFriendHint({ name })}</span>
                        {/if}
                    </span>
                </button>
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
            {#if friendAction?.danger}
                <button
                    type="button"
                    class="u-menu-row u-danger !m-0"
                    data-testid="partnerFriendAction"
                    on:click={friendAction.act}
                >
                    <span class="u-menu-tile"><svelte:component this={friendAction.icon} /></span>
                    <span class="truncate">{friendAction.label}</span>
                </button>
            {/if}
            {#if canBlockPartner(partner)}
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
                                ? $LL.chat.directChat.profile.unblock({ name })
                                : $LL.chat.directChat.profile.block({ name })}</span
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
                    on:click={() => reportPartner(partner, name)}
                >
                    <span class="u-menu-tile"><IconFlag /></span>
                    <span class="flex min-w-0 flex-1 flex-col">
                        <span class="truncate">{$LL.chat.directChat.profile.report({ name })}</span>
                        <span class="partner-hint">{$LL.chat.directChat.profile.reportHint()}</span>
                    </span>
                </button>
            {/if}
            {#if confirmingDelete}
                <div class="flex flex-col gap-2 p-2 text-sm" data-testid="partnerDeleteConfirm">
                    <span class="font-bold"
                        >{isBrick
                            ? $LL.chat.directChat.clearChat.confirm()
                            : $LL.chat.directChat.deleteChat.confirm()}</span
                    >
                    <span class="text-xs text-white/60"
                        >{isBrick
                            ? $LL.chat.directChat.clearChat.confirmHint({ name })
                            : $partnerHolds
                            ? $LL.chat.directChat.deleteChat.hint({ name })
                            : $LL.chat.directChat.deleteChat.hintGone({ name })}</span
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
                            on:click={deleteChat}
                            >{isBrick
                                ? $LL.chat.directChat.clearChat.confirmButton()
                                : $LL.chat.directChat.deleteChat.confirmButton()}</button
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
                    <span class="u-menu-tile"
                        >{#if isBrick}<IconRotate />{:else}<IconTrash />{/if}</span
                    >
                    <span class="flex min-w-0 flex-1 flex-col">
                        <span class="truncate"
                            >{isBrick
                                ? $LL.chat.directChat.clearChat.label()
                                : $LL.chat.directChat.deleteChat.label()}</span
                        >
                        <span class="partner-hint"
                            >{isBrick
                                ? $LL.chat.directChat.clearChat.hint({ name })
                                : $partnerHolds
                                ? $LL.chat.directChat.deleteChat.hint({ name })
                                : $LL.chat.directChat.deleteChat.hintGone({ name })}</span
                        >
                    </span>
                </button>
            {/if}
        </div>
    </div>
</div>

<style lang="scss">
    /* A Brick's look on the dark ring its own page gives it */
    .partner-look {
        display: grid;
        place-items: center;
        width: 66px;
        height: 66px;
        border-radius: 50%;
        background: #2a2340;
        box-shadow: 0 0 0 2px rgba(167, 139, 250, 0.45);
    }
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
