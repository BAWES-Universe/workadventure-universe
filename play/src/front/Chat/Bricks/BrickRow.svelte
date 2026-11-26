<script lang="ts">
    import { getContext, hasContext } from "svelte";
    import { readable } from "svelte/store";
    import type { Readable } from "svelte/store";
    import highlightWords from "highlight-words";
    import LL, { locale } from "../../../i18n/i18n-svelte";
    import { localUserStore } from "../../Connection/LocalUserStore";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { botStatusColour } from "../Bots/BotChatStatus";
    import { botStatusCache } from "../Bots/BotStatusStore";
    import { minuteClock } from "../Components/OneList/MinuteClock";
    import { formatRowTime, formatUnreadCount } from "../Components/OneList/OneListOrder";
    import StatusDot from "../Components/Status/StatusDot.svelte";
    import TopRowAvatar from "../Components/TopRow/TopRowAvatar.svelte";
    import { chatSearchBarValue } from "../Stores/ChatStore";
    import { PERSON_COLOUR_CONTEXT } from "../Stores/ChatUserWokaStore";
    import type { PersonColourOf } from "../Stores/ChatUserWokaStore";
    import { brickChatId, brickMadeAt, type BrickCard } from "./Brick";
    import { brickHello } from "./BrickHello";
    import { openBrickChat, openingBrickChats, unopenedBricksOf } from "./BrickChat";
    import { brickPicture } from "./MyBricksStore";
    import { GUEST_BRICK_ID } from "./GuestBrick";
    import { guestBrickOnline, guestBrickRoom } from "./GuestBrickStore";

    /**
     * A person's own Brick in Chats before this device has its chat (game #1995): the Brick is just there, with its hello
     * as the line under its name, and nothing was sent to anyone. While the person never opened it, its hello counts as one
     * unread message like any other: a bold name, the time in colour and a "1", the same count the Chats tab and the chat
     * button carry. Laid out as a direct chat's row (Room.svelte), which takes its place once the chat exists. A tap opens
     * the chat at once, on a screen that is the Brick's own. The Brick for guests (#1997)
     * is drawn the same way: always online, and the line under its name is the last thing said in the chat their device keeps.
     */
    export let brick: BrickCard;

    const forGuest = brick.id === GUEST_BRICK_ID;
    const guestLast = forGuest ? guestBrickRoom().last : readable(undefined);

    const colourOf: Readable<PersonColourOf> = hasContext(PERSON_COLOUR_CONTEXT)
        ? getContext(PERSON_COLOUR_CONTEXT)
        : readable(() => undefined);
    const myChatId = localUserStore.getChatId();

    const unopened = unopenedBricksOf(gameManager.chatConnection);

    $: state = forGuest ? guestBrickOnline : botStatusCache.store(brick.id);
    $: isNew = !forGuest && $unopened.has(brick.id);
    $: opening = $openingBrickChats.has(brick.id);
    $: preview = forGuest
        ? $guestLast?.text ?? $LL.chat.brick.guest.hello()
        : brickHello(brick.name, $LL, gameManager.getPlayerName(), brick.hello);
    $: chunks = highlightWords({ text: brick.name, query: $chatSearchBarValue });
    $: timeLabel = formatRowTime(brickMadeAt(brick), $minuteClock, $locale, {
        justNow: $LL.chat.oneList.justNow(),
        minutes: (count) => $LL.chat.oneList.minutesShort({ count }),
        yesterday: $LL.chat.oneList.yesterday(),
    });

    function open() {
        openBrickChat(brick.id).catch((error) => console.error(error));
    }

    function onKey(event: KeyboardEvent) {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        open();
    }
</script>

<div
    class="group/chatItem relative text-md m-0 flex gap-3 flex-row items-center min-h-14 ps-2 pe-2 py-2 rounded-xl hover:bg-white/10 transition-colors hover:!cursor-pointer cursor-pointer w-full"
    role="button"
    tabindex="0"
    aria-busy={opening}
    data-testid="brickRow"
    on:click={open}
    on:keydown={onKey}
>
    <div class="relative shrink-0">
        <TopRowAvatar
            pictureStore={brickPicture(brick.characterTextureId)}
            name={brick.name}
            color={$colourOf(brickChatId(brick.id, myChatId), brick.name)}
            size="lg"
            ring={false}
        />
        {#if $state}
            <StatusDot color={botStatusColour($state)} />
        {/if}
    </div>
    <div class="m-0 flex min-w-0 flex-1 flex-col text-start">
        <div class="flex min-w-0 items-baseline gap-2">
            <div class="min-w-0 grow truncate">
                {#each chunks as chunk (chunk.key)}
                    <span
                        class="{chunk.match ? 'text-light-blue' : ''} {isNew
                            ? 'text-white font-bold'
                            : 'text-white/85'} cursor-default text-sm">{chunk.text}</span
                    >
                {/each}
            </div>
            {#if timeLabel}
                <span
                    class="shrink-0 text-[11px] {isNew ? 'text-secondary-400 font-semibold' : 'text-white/50'}"
                    data-testid="roomRowTime">{timeLabel}</span
                >
            {/if}
        </div>
        <div class="flex min-w-0 items-center gap-2 text-xs text-white/60">
            <span class="min-w-0 grow truncate" data-testid="roomRowPreview">{preview}</span>
            {#if isNew}
                <span
                    class="shrink-0 min-w-5 h-5 px-1.5 rounded-full u-badge text-white text-[11px] font-bold flex items-center justify-center"
                    data-testid="roomRowUnread"
                    aria-label={$LL.chat.areaRow.unread({ count: 1 })}>{formatUnreadCount(1)}</span
                >
            {/if}
        </div>
    </div>
</div>
