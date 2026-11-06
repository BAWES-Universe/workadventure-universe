<script lang="ts">
    import { createEventDispatcher, getContext, hasContext } from "svelte";
    import { readable } from "svelte/store";
    import type { Readable } from "svelte/store";
    import LL, { locale } from "../../../../../i18n/i18n-svelte";
    import type { ChatRoom } from "../../../Connection/ChatConnection";
    import type { PictureStore } from "../../../../Stores/PictureStore";
    import {
        NAME_BY_CHAT_ID_CONTEXT,
        PERSON_COLOUR_CONTEXT,
        WOKA_BY_CHAT_ID_CONTEXT,
        personName,
        personPicture,
    } from "../../../Stores/ChatUserWokaStore";
    import { requestChatPerson } from "../../../Stores/ChatPeopleLookup";
    import type { PersonColourOf } from "../../../Stores/ChatUserWokaStore";
    import TopRowAvatar from "../../TopRow/TopRowAvatar.svelte";
    import type { BotAvailability } from "../../../Bots/BotChatStatus";
    import { friendsStore } from "../../../Stores/FriendsStore";
    import BotStatusLine from "../../Bots/BotStatusLine.svelte";
    import StatusDot from "../../Status/StatusDot.svelte";
    import { statusDotColour, statusWords } from "../../Status/ChatStatus";
    import type { ChatStatusFacts } from "../../Status/ChatStatus";
    import type { DirectPartner } from "./DirectPartnerStore";
    import { IconLock } from "@wa-icons";

    /**
     * Header title of a direct chat, laid out like every other chat: their woka with the status dot the Chats list
     * shows, their name, and where they are right now in plain grey words. Tapping it opens their profile.
     */
    export let room: ChatRoom;
    export let partner: DirectPartner;
    /** Set for a chat with a bot: its state replaces where a person is. Undefined state shows no line at all. */
    export let bot = false;
    export let botState: BotAvailability | undefined = undefined;
    /** The bot's state for the dot. It differs from the words only where the header stays quiet (someone with no access). */
    export let botDotState: BotAvailability | undefined = botState;

    const dispatch = createEventDispatcher<{ openProfile: void }>();
    const roomName = room.name;
    const isEncrypted = room.isEncrypted;
    const wokaByChatId: Readable<Map<string, PictureStore>> = hasContext(WOKA_BY_CHAT_ID_CONTEXT)
        ? getContext(WOKA_BY_CHAT_ID_CONTEXT)
        : readable(new Map<string, PictureStore>());
    const nameByChatId: Readable<Map<string, string>> = hasContext(NAME_BY_CHAT_ID_CONTEXT)
        ? getContext(NAME_BY_CHAT_ID_CONTEXT)
        : readable(new Map<string, string>());
    const colourOf: Readable<PersonColourOf> = hasContext(PERSON_COLOUR_CONTEXT)
        ? getContext(PERSON_COLOUR_CONTEXT)
        : readable(() => undefined);

    // Someone outside the world is asked of Orbit (once), for their Woka and the name they go by.
    $: partnerChatId = partner.chatId;
    $: requestChatPerson(partnerChatId);
    $: name = personName($nameByChatId, partnerChatId, $roomName);
    $: picture = personPicture($wokaByChatId, partner.chatId, room.pictureStore);
    // A friend who shares their room: when they were last in Universe, said in days.
    $: lastSeenAt =
        partner.chatId && $friendsStore.status !== "signedOut"
            ? $friendsStore.list?.friends.find((friend) => friend.chatId === partner.chatId)?.lastSeenAt || undefined
            : undefined;
    $: facts = (
        bot ? { kind: "bot", state: botDotState } : { kind: "person", place: partner.place, lastSeenAt }
    ) as ChatStatusFacts;
    $: dot = statusDotColour(facts, $LL);
    $: words = bot ? undefined : statusWords(facts, $LL, $locale, Date.now());
</script>

<button
    type="button"
    class="m-0 flex min-w-0 max-w-full items-center gap-2.5 rounded-xl py-1 pe-2 ps-1 text-start text-white [font:inherit] {bot
        ? 'min-h-11 hover:bg-white/[0.08]'
        : 'hover:bg-white/10'}"
    aria-label={$LL.chat.directChat.openProfile({ name })}
    data-testid="openPartnerProfile"
    on:click={() => dispatch("openProfile")}
>
    <span class="relative flex shrink-0" aria-hidden="true">
        <TopRowAvatar pictureStore={picture} {name} color={$colourOf(partner.chatId, name)} ring={false} />
        {#if dot}
            <StatusDot color={dot} size="sm" />
        {/if}
    </span>
    <span class="flex min-w-0 flex-col">
        <span class="flex min-w-0 items-center gap-1.5">
            <span class="truncate text-md font-bold leading-5" data-testid="roomName">{name}</span>
            {#if $isEncrypted}
                <span
                    class="shrink-0 text-white/50"
                    title={$LL.chat.thread.encrypted()}
                    data-testid="threadEncryptedLock"
                >
                    <IconLock font-size="14" />
                </span>
            {/if}
        </span>
        {#if bot}
            {#if botState}
                <BotStatusLine state={botState} />
            {/if}
        {:else if words}
            <span class="truncate text-xs text-white/60" data-testid="partnerStatus">{words}</span>
        {/if}
    </span>
</button>
