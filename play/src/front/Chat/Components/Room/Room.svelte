<script lang="ts">
    import highlightWords from "highlight-words";
    import type {
        ChatRoom,
        ChatRoomMembershipManagement,
        ChatRoomModeration,
        ChatRoomNotificationControl,
    } from "../../Connection/ChatConnection";
    import LL, { locale } from "../../../../i18n/i18n-svelte";
    import { chatSearchBarValue } from "../../Stores/ChatStore";
    import { selectedRoomStore } from "../../Stores/SelectRoomStore";
    import Avatar from "../Avatar.svelte";
    import EncryptionBadge from "../EncryptionBadge.svelte";
    import { formatTypingLine } from "../TopRow/TopRowSummary";
    import { formatRowTime, formatUnreadCount, normalizeTimestamp, toPlainText } from "../OneList/OneListOrder";
    import { minuteClock } from "../OneList/MinuteClock";
    import RoomMenu from "./RoomMenu/RoomMenu.svelte";
    import { IconBellOff } from "@wa-icons";

    export let room: ChatRoom & ChatRoomMembershipManagement & ChatRoomModeration & ChatRoomNotificationControl;

    let hasUnreadMessage = room.hasUnreadMessages;
    let roomName = room.name;
    let isEncrypted = room.isEncrypted;
    const areNotificationsMuted = room.areNotificationsMuted;
    const unreadCount = room.unreadNotificationCount;
    const typingMembers = room.typingMembers;
    const messages = room.messages;

    $: chunks = highlightWords({
        text: $roomName.match(/\[\d*]/) ? $roomName.substring(0, $roomName.search(/\[\d*]/)) : $roomName,
        query: $chatSearchBarValue,
    });

    $: isSelected = $selectedRoomStore?.id === room.id;

    $: typingLine = formatTypingLine(
        $typingMembers.map((member) => member.name),
        {
            one: $LL.chat.topRow.typingOne,
            two: $LL.chat.topRow.typingTwo,
            many: $LL.chat.topRow.typingMany,
            someone: $LL.chat.topRow.someone(),
        }
    );

    $: latestMessage = $messages.length > 0 ? $messages[$messages.length - 1] : undefined;
    $: latestMessageContent = latestMessage?.content;
    $: latestMessageText = $latestMessageContent ? toPlainText($latestMessageContent.body) : "";
    // In a DM the other person's name is the row's title already: only "You:" is worth saying.
    $: latestMessageSender = latestMessage
        ? latestMessage.isMyMessage
            ? $LL.chat.topRow.you()
            : room.type === "direct"
            ? undefined
            : latestMessage.sender?.username ?? $LL.chat.topRow.someone()
        : undefined;
    $: preview = latestMessageText
        ? latestMessageSender
            ? `${latestMessageSender}: ${latestMessageText}`
            : latestMessageText
        : "";

    // `lastMessageTimestamp` is a plain getter: read it again whenever the messages change.
    function timestampAfter(changedMessages: readonly unknown[]): number {
        return changedMessages ? normalizeTimestamp(room.lastMessageTimestamp) : 0;
    }
    $: timestamp = timestampAfter($messages);
    $: timeLabel = formatRowTime(timestamp, $minuteClock, $locale, {
        justNow: $LL.chat.oneList.justNow(),
        minutes: (count) => $LL.chat.oneList.minutesShort({ count }),
        yesterday: $LL.chat.oneList.yesterday(),
    });
</script>

<div
    class="group/chatItem relative text-md m-0 flex gap-3 flex-row items-center min-h-14 ps-2 pe-1 py-2 rounded-xl hover:bg-white/10 transition-colors hover:!cursor-pointer cursor-pointer w-full"
    class:bg-white={isSelected}
    class:bg-opacity-10={isSelected}
    on:click={() => selectedRoomStore.set(room)}
    on:keyup={() => selectedRoomStore.set(room)}
    role="button"
    tabindex="0"
    aria-current={isSelected ? "true" : undefined}
    data-testid={$roomName}
>
    <div class="relative shrink-0">
        <Avatar pictureStore={room.pictureStore} fallbackName={$roomName} size="lg" round={room.type === "direct"} />

        {#if $isEncrypted}
            <EncryptionBadge />
        {/if}
    </div>
    <div class="m-0 flex min-w-0 flex-1 flex-col text-start">
        <div class="flex min-w-0 items-baseline gap-2">
            <div class="min-w-0 grow truncate">
                {#each chunks as chunk (chunk.key)}
                    <span
                        class="{chunk.match ? 'text-light-blue' : ''} {$hasUnreadMessage
                            ? 'text-white font-bold'
                            : 'text-white/85'} cursor-default text-sm">{chunk.text}</span
                    >
                {/each}
            </div>
            {#if timeLabel}
                <span
                    class="shrink-0 text-[11px] {$hasUnreadMessage
                        ? 'text-secondary-400 font-semibold'
                        : 'text-white/50'}"
                    data-testid="roomRowTime">{timeLabel}</span
                >
            {/if}
        </div>
        <div class="flex min-w-0 items-center gap-2 text-xs text-white/60">
            <span class="min-w-0 grow truncate" data-testid="roomRowPreview">
                {#if typingLine}
                    <span class="text-secondary-400">{typingLine}…</span>
                {:else}
                    {preview}
                {/if}
            </span>
            {#if $areNotificationsMuted}
                <IconBellOff font-size="12" class="shrink-0 opacity-50" aria-label={$LL.chat.oneList.muted()} />
            {/if}
            {#if $hasUnreadMessage}
                {#if $unreadCount > 0}
                    <span
                        class="shrink-0 min-w-5 h-5 px-1.5 rounded-full {$areNotificationsMuted
                            ? 'bg-white/30'
                            : 'bg-secondary'} text-white text-[11px] font-bold flex items-center justify-center"
                        data-testid="roomRowUnread"
                        aria-label={$LL.chat.areaRow.unread({ count: $unreadCount })}
                        >{formatUnreadCount($unreadCount)}</span
                    >
                {:else}
                    <span class="flex shrink-0 items-center justify-center h-5 w-5 relative">
                        <span class="rounded-full bg-secondary-200 h-2 w-2 motion-safe:animate-ping absolute" />
                        <span class="rounded-full bg-secondary-200 h-1.5 w-1.5 absolute" />
                    </span>
                {/if}
            {/if}
        </div>
    </div>
    <RoomMenu {room} />
</div>
