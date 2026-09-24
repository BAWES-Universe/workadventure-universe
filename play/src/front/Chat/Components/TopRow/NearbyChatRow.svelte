<script lang="ts">
    import { readable } from "svelte/store";
    import LL, { locale } from "../../../../i18n/i18n-svelte";
    import type { ProximityChatRoom } from "../../Connection/Proximity/ProximityChatRoom";
    import type { ChatMessage } from "../../Connection/ChatConnection";
    import type { PictureStore } from "../../../Stores/PictureStore";
    import { formatRowTime, toPlainText } from "../OneList/OneListOrder";
    import { minuteClock } from "../OneList/MinuteClock";
    import TopRowAvatar from "./TopRowAvatar.svelte";
    import { formatPeopleNames } from "./TopRowSummary";

    /**
     * The nearby (proximity) chat you had, as a row of the chat list, once the bubble is over.
     * It stays for the session, like the proximity chat itself; while you're in a bubble the live card shows instead.
     */
    export let proximityChatRoom: ProximityChatRoom;
    export let onOpen: () => void;

    const MAX_AVATARS = 2;
    const messages = proximityChatRoom.messages;
    const hasUnreadMessages = proximityChatRoom.hasUnreadMessages;

    interface Talker {
        key: string;
        name: string;
        pictureStore: PictureStore;
    }

    function talkersOf(list: readonly ChatMessage[]): Talker[] {
        const talkers: Talker[] = [];
        const seen = new Set<string>();
        for (let i = list.length - 1; i >= 0; i--) {
            const message = list[i];
            if (message.type !== "proximity" || message.isMyMessage || !message.sender) continue;
            const name = message.sender.username?.trim();
            if (!name) continue;
            const key = message.sender.chatId ?? message.sender.uuid ?? name;
            if (seen.has(key)) continue;
            seen.add(key);
            const pictureStore =
                "pictureStore" in message.sender && message.sender.pictureStore
                    ? message.sender.pictureStore
                    : readable<string | undefined>(undefined);
            talkers.push({ key, name, pictureStore });
        }
        return talkers;
    }

    $: lastMessage = [...$messages].reverse().find((message) => message.type === "proximity");
    $: lastContent = lastMessage?.content;
    $: lastText = $lastContent ? toPlainText($lastContent.body) : "";
    $: lastSender = lastMessage
        ? lastMessage.isMyMessage
            ? $LL.chat.topRow.you()
            : lastMessage.sender?.username ?? $LL.chat.topRow.someone()
        : "";
    $: preview = lastText ? `${lastSender}: ${lastText}` : "";

    $: talkers = talkersOf($messages);
    $: shownTalkers = talkers.slice(0, MAX_AVATARS);
    $: names = formatPeopleNames(
        talkers.map((talker) => talker.name),
        { two: $LL.chat.topRow.twoNames, more: $LL.chat.topRow.moreNames }
    );
    $: title = names ? $LL.chat.nearby.withNames({ names }) : $LL.chat.nearby.title();
    $: timeLabel = lastMessage?.date
        ? formatRowTime(lastMessage.date.getTime(), $minuteClock, $locale, {
              justNow: $LL.chat.oneList.justNow(),
              minutes: (count) => $LL.chat.oneList.minutesShort({ count }),
              yesterday: $LL.chat.oneList.yesterday(),
          })
        : "";
</script>

{#if lastMessage}
    <button
        type="button"
        class="group relative m-0 flex w-full items-center gap-3 min-h-14 ps-2 pe-3 py-2 rounded-xl text-start bg-transparent hover:bg-white/10 focus:outline-none focus-visible:bg-white/10"
        data-testid="nearbyChatRow"
        on:click={onOpen}
    >
        <div class="relative h-10 w-10 shrink-0" aria-hidden="true">
            {#if shownTalkers.length >= 2}
                <div class="absolute start-0 top-0">
                    <TopRowAvatar pictureStore={shownTalkers[0].pictureStore} name={shownTalkers[0].name} />
                </div>
                <div class="absolute end-0 bottom-0 scale-75 origin-bottom-right rtl:origin-bottom-left">
                    <TopRowAvatar pictureStore={shownTalkers[1].pictureStore} name={shownTalkers[1].name} />
                </div>
            {:else if shownTalkers.length === 1}
                <TopRowAvatar
                    pictureStore={shownTalkers[0].pictureStore}
                    name={shownTalkers[0].name}
                    size="lg"
                    ring={false}
                />
            {:else}
                <TopRowAvatar
                    pictureStore={readable(undefined)}
                    name={$LL.chat.nearby.title()}
                    size="lg"
                    ring={false}
                />
            {/if}
        </div>
        <div class="flex min-w-0 grow flex-col">
            <div class="flex min-w-0 items-baseline gap-2">
                <span
                    class="min-w-0 grow truncate {$hasUnreadMessages ? 'text-white font-bold' : 'text-white/90'}"
                    data-testid="nearbyChatRowTitle">{title}</span
                >
                {#if timeLabel}
                    <span class="shrink-0 text-xs tabular-nums text-white/50">{timeLabel}</span>
                {/if}
            </div>
            <div class="flex min-w-0 items-center gap-2">
                <span class="min-w-0 grow truncate text-sm {$hasUnreadMessages ? 'text-white/85' : 'text-white/60'}"
                    >{preview}</span
                >
                {#if $hasUnreadMessages}
                    <span class="h-2 w-2 shrink-0 rounded-full bg-secondary-200" aria-hidden="true" />
                {/if}
            </div>
        </div>
    </button>
{/if}
