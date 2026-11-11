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
    import { formatRowTime } from "../Components/OneList/OneListOrder";
    import StatusDot from "../Components/Status/StatusDot.svelte";
    import TopRowAvatar from "../Components/TopRow/TopRowAvatar.svelte";
    import { chatSearchBarValue } from "../Stores/ChatStore";
    import { PERSON_COLOUR_CONTEXT } from "../Stores/ChatUserWokaStore";
    import type { PersonColourOf } from "../Stores/ChatUserWokaStore";
    import { brickChatId, brickMadeAt, type BrickCard } from "./Brick";
    import { brickHello } from "./BrickHello";
    import { openBrickChat, openingBrickChats } from "./BrickChat";
    import { brickPicture } from "./MyBricksStore";
    import { IconLoader } from "@wa-icons";

    /**
     * A person's own Brick in Chats before they ever opened its chat (game #1995): the Brick is just there, with its
     * hello as the line under its name and no unread badge, and nothing was sent to anyone. Laid out as a direct chat's
     * row (Room.svelte), which takes its place once the chat exists. A tap opens the chat.
     */
    export let brick: BrickCard;

    const colourOf: Readable<PersonColourOf> = hasContext(PERSON_COLOUR_CONTEXT)
        ? getContext(PERSON_COLOUR_CONTEXT)
        : readable(() => undefined);
    const myChatId = localUserStore.getChatId();

    $: state = botStatusCache.store(brick.id);
    $: opening = $openingBrickChats.has(brick.id);
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
                    <span class="{chunk.match ? 'text-light-blue' : ''} text-white/85 cursor-default text-sm"
                        >{chunk.text}</span
                    >
                {/each}
            </div>
            {#if timeLabel}
                <span class="shrink-0 text-[11px] text-white/50" data-testid="roomRowTime">{timeLabel}</span>
            {/if}
        </div>
        <div class="flex min-w-0 items-center gap-2 text-xs text-white/60">
            <span class="min-w-0 grow truncate" data-testid="roomRowPreview"
                >{brickHello(brick.name, $LL, gameManager.getPlayerName())}</span
            >
        </div>
    </div>
    {#if opening}
        <span class="flex h-8 w-8 shrink-0 items-center justify-center text-white/60" data-testid="brickRowOpening">
            <IconLoader class="animate-[spin_2s_linear_infinite]" font-size="18" />
        </span>
    {/if}
</div>
