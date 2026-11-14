<script lang="ts">
    import type { AvailabilityStatus } from "@workadventure/messages";
    import { onDestroy } from "svelte";
    import { readable } from "svelte/store";
    import { wokaMenuStore, wokaMenuProgressStore } from "../../Stores/WokaMenuStore";
    import type { WokaMenuAction, WokaMenuData } from "../../Stores/WokaMenuStore";
    import VisitCard from "../VisitCard/VisitCard.svelte";
    import WokaFromUserId from "../Woka/WokaFromUserId.svelte";
    import Woka from "../Woka/Woka.svelte";
    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import LL from "../../../i18n/i18n-svelte";
    import type { TranslationFunctions } from "../../../i18n/i18n-types";
    import { peopleCardReturn } from "../../Chat/Stores/PeopleCardReturnStore";
    import { availabilityStatusStore } from "../../Stores/MediaStore";
    import { getColorHexOfStatus } from "../../Utils/AvailabilityStatus";
    import { localUserStore } from "../../Connection/LocalUserStore";
    import { resolveRoles, rolesToShow, worldRolesStore } from "../../Chat/Roles/WorldRoles";
    import { statusLabel } from "../../Chat/Components/UserList/PersonStatus";
    import { friendsEnabledStore, relationshipsStore } from "../../Chat/Stores/FriendsStore";
    import { blackListManager } from "../../WebRtc/BlackListManager";
    import { isBotUser } from "../../Chat/UserProvider/ChatUserMapper";
    import { botStatusCache } from "../../Chat/Bots/BotStatusStore";
    import { botStatusColour } from "../../Chat/Bots/BotChatStatus";
    import { botFeeling, WORK_EMOJI } from "../../Chat/Bots/BotMood";
    import { botCardInfo, type BotCardInfo } from "../../external-modules/bots/botCardInfo";
    import { visitingWith } from "../../Chat/Bricks/BrickVisit";
    import BotFeelings from "../../external-modules/bots/components/BotFeelings.svelte";
    import PersonCardView from "./PersonCardView.svelte";
    import { worldUsersStore } from "./personCardContext";
    import {
        findWorldUser,
        splitCardActions,
        toCardAction,
        type CardRelation,
        type CardRole,
        type CardStatus,
    } from "./personCardModel";

    let wokaMenuData: WokaMenuData | undefined;
    /** The "more" (⋯) list is open. It closes whenever the card turns to someone else. */
    let moreOpen = false;
    let moreOpenFor: string | undefined;

    const worldUsers = worldUsersStore();

    const wokaMenuStoreUnsubscriber = wokaMenuStore.subscribe((value) => {
        wokaMenuData = value;
        if (wokaMenuData) {
            const cardFor = `${wokaMenuData.userUuid}#${wokaMenuData.userId}#${wokaMenuData.isSelf ? "me" : ""}`;
            if (cardFor !== moreOpenFor) {
                moreOpen = false;
                moreOpenFor = cardFor;
            }
        }
    });
    onDestroy(wokaMenuStoreUnsubscriber);

    // Searching for someone far away (not on your screen yet): their Woka as People shows it, until the card turns to
    // their avatar once found.
    $: searchPicture = wokaMenuData?.searchPicture;

    $: isSelf = !!wokaMenuData?.isSelf;
    $: userUuid = wokaMenuData?.userUuid ?? "";
    $: worldUser = wokaMenuData ? findWorldUser($worldUsers, userUuid, wokaMenuData.userId) : undefined;
    $: isBot = isBotUser({ uuid: userUuid, tags: worldUser?.tags });
    $: botId = isBot && userUuid.startsWith("bot-") ? userUuid.substring(4) : undefined;
    // Another tab or device of your own account: there is no chat or friendship with yourself.
    $: isMyOtherSession = !isSelf && !!userUuid && userUuid === localUserStore.getLocalUser()?.uuid;

    // What a bot's card says about it, asked when the card turns to it; its buttons wait for the answer
    // (opened again for the same bot, it asks again)
    $: opening = wokaMenuData?.opening;
    $: botInfo = botId ? botCardInfo(botId, opening) : readable<BotCardInfo>({ loading: false });
    $: botAvailability = botId ? botStatusCache.store(botId) : readable(undefined);
    $: feeling = botId && worldUser ? botFeeling(worldUser.spaceUserId) : readable(undefined);

    // ── Actions: the ones for the grid and the ones under More ──
    $: split = wokaMenuData ? splitCardActions(wokaMenuData.actions, isBot) : { main: [], more: [] };
    $: tiles = split.main.map(toCardAction);
    $: moreRows = split.more.map(toCardAction);
    $: actionsByCardId = new Map<string, WokaMenuAction>(
        [...split.main, ...split.more].map((action) => [toCardAction(action).id, action])
    );
    // The buttons show once every answer is in, so none appears later and moves the others (#1790)
    $: waiting = (wokaMenuData?.pending.length ?? 0) > 0 || (!!botId && $botInfo.loading);

    // ── Header ──
    $: statusStore = isSelf
        ? availabilityStatusStore
        : worldUser?.reactiveUser.availabilityStatus ?? readable(undefined);
    // A Brick that walks beside someone (game #2005) says whose it is and who it is with, in the place of "Online", unless
    // it is resting or not ready: that is worth more to know
    $: visiting = isBot ? visitingWith(worldUser?.tags) : undefined;
    $: ordinaryStatus = cardStatus(isBot, $botAvailability, $statusStore, isSelf, isMyOtherSession, $LL);
    $: status =
        visiting && ordinaryStatus?.colour === botStatusColour("online")
            ? {
                  label: `${$LL.chat.brick.madeBy({ name: visiting })} · ${$LL.chat.brick.visitingWith({
                      name: visiting,
                  })}`,
              }
            : ordinaryStatus;

    function cardStatus(
        bot: boolean,
        botState: string | undefined,
        availability: AvailabilityStatus | undefined,
        self: boolean,
        otherSession: boolean,
        ll: TranslationFunctions
    ): CardStatus | undefined {
        if (bot) {
            if (botState === "resting") {
                return {
                    label: ll.chat.personCard.restingStatus({ state: ll.chat.botStatus.resting() }),
                    colour: botStatusColour("resting"),
                };
            }
            if (botState === "unready" || botState === "gone") {
                return { label: ll.chat.botStatus[botState](), colour: botStatusColour(botState) };
            }
            // Online, and while its state is not known yet: a bot on the map is on
            return { label: ll.chat.botStatus.online(), colour: botStatusColour("online") };
        }
        if (!availability) return undefined;
        const label = statusLabel(availability, ll);
        const colour = getColorHexOfStatus(availability);
        if (self) return { label: ll.chat.personCard.youSuffix({ status: label }), colour };
        if (otherSession) return { label: ll.chat.personCard.otherTabSuffix({ status: label }), colour };
        return { label, colour };
    }

    // Every role they hold (no "+N": the card has the room). A world whose admin sends no list keeps the Admin badge.
    $: roles = cardRoles(isBot, $worldRolesStore, worldUser?.tags, isSelf, $LL);
    function cardRoles(
        bot: boolean,
        catalogue: Parameters<typeof resolveRoles>[1],
        tags: string[] | undefined,
        self: boolean,
        ll: TranslationFunctions
    ): CardRole[] {
        if (bot) return [];
        if (catalogue) {
            return rolesToShow(resolveRoles(tags, catalogue), self).map((role) => ({
                name: role.name,
                color: role.color,
            }));
        }
        return tags?.includes("admin") ? [{ name: ll.chat.role.admin(), color: "#3b82f6" }] : [];
    }

    $: relation = cardRelation(
        $relationshipsStore.get(userUuid),
        $friendsEnabledStore,
        isSelf || isBot || isMyOtherSession
    );
    function cardRelation(
        relationship: string | undefined,
        enabled: boolean,
        noFriendship: boolean
    ): CardRelation | undefined {
        if (!enabled || noFriendship) return undefined;
        if (relationship === "friends") return "friend";
        if (relationship === "request_sent") return "requestSent";
        if (relationship === "request_received") return "requestReceived";
        return undefined;
    }

    // Read when the card turns to someone: blocking closes the card, so it cannot change under it
    $: blocked = userUuid !== "" && !isSelf && blackListManager.isBlackListed(userUuid);

    $: mood = $feeling?.mood ?? ($feeling?.work ? WORK_EMOJI[$feeling.work] : undefined);

    function displayName(name: string): string {
        // The name as its owner saved it, first letter capitalised; never all capitals.
        return name.charAt(0).toUpperCase() + name.slice(1);
    }

    function onKeyDown(e: KeyboardEvent) {
        if (e.key === "Escape" && wokaMenuData) {
            dismiss();
        }
    }

    // Closed without doing anything: on a phone, back to the People tab if the card was opened from it.
    function dismiss() {
        peopleCardReturn.dismissCard();
    }

    function runAction(cardId: string) {
        const action = actionsByCardId.get(cardId);
        if (!action) return;
        analyticsClient.clickPropertyMapEditor(action.actionName, action.style);
        wokaMenuStore.clear();
        action.callback();
    }
</script>

<svelte:window on:keydown={onKeyDown} />

{#if wokaMenuData}
    <!-- screen-blocker: the camera keeps the person this card is about in the space beside it, not under it. -->
    <div
        class="m-auto my-0 min-h-0 max-w-lg min-w-48 max-sm:max-w-[89%] z-50 transition-all rounded-lg pointer-events-auto flex flex-col screen-blocker"
        data-testid="person-card"
    >
        <PersonCardView
            name={displayName(wokaMenuData.wokaName)}
            {mood}
            {status}
            {roles}
            {relation}
            {blocked}
            loading={waiting}
            progress={$wokaMenuProgressStore?.message}
            actions={tiles}
            more={moreRows}
            {moreOpen}
            on:close={dismiss}
            on:more={() => (moreOpen = !moreOpen)}
            on:select={(event) => runAction(event.detail)}
        >
            <svelte:fragment slot="woka">
                {#if wokaMenuData.isSelf || (wokaMenuData.userId != undefined && wokaMenuData.userId != -1)}
                    <WokaFromUserId
                        userId={wokaMenuData.isSelf ? -1 : wokaMenuData.userId}
                        placeholderSrc="/assets/placeholder-woka.png"
                        customWidth="4rem"
                    />
                {:else if $searchPicture}
                    <Woka src={$searchPicture} customWidth="4rem" />
                {/if}
            </svelte:fragment>

            {#if botId}
                {#if $botInfo.description}
                    <p class="bot-description">{$botInfo.description}</p>
                {/if}
                {#if visiting}
                    <p class="bot-visiting" data-testid="visitingBrickLine">
                        {$LL.chat.brick.visitingCardLine({ name: visiting })}
                    </p>
                {/if}
                {#if $botInfo.emotions !== undefined}
                    <BotFeelings botName={displayName(wokaMenuData.wokaName)} emotions={$botInfo.emotions} />
                {/if}
            {:else if wokaMenuData.visitCardUrl}
                <VisitCard visitCardUrl={wokaMenuData.visitCardUrl} isEmbedded={true} showSendMessageButton={false} />
            {/if}
        </PersonCardView>
    </div>
{/if}

<style lang="scss">
    .bot-visiting {
        margin: 0 18px 10px;
        font-size: 14.5px;
        line-height: 1.45;
        color: rgb(255 255 255 / 0.62);
    }
    .bot-description {
        margin: 4px 18px 10px;
        font-size: 15px;
        line-height: 1.5;
        color: rgb(255 255 255 / 0.82);
        white-space: pre-wrap;
        overflow-wrap: anywhere;
    }
</style>
