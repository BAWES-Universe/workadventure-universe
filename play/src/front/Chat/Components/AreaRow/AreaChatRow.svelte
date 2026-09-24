<script lang="ts">
    import LL from "../../../../i18n/i18n-svelte";
    import type {
        ChatRoom,
        ChatRoomMembershipManagement,
        ChatRoomModeration,
        ChatRoomNotificationControl,
    } from "../../Connection/ChatConnection";
    import { selectedRoomStore } from "../../Stores/SelectRoomStore";
    import EncryptionBadge from "../EncryptionBadge.svelte";
    import RoomMenu from "../Room/RoomMenu/RoomMenu.svelte";
    import { formatTypingLine } from "../TopRow/TopRowSummary";
    import { IconBellOff, IconMapPin } from "@wa-icons";

    export let room: ChatRoom & ChatRoomMembershipManagement & ChatRoomModeration & ChatRoomNotificationControl;
    /** The name of the area the room belongs to; the room's own name is used when the area has none. */
    export let areaName: string | undefined;

    const roomName = room.name;
    const hasUnreadMessages = room.hasUnreadMessages;
    const unreadCount = room.unreadNotificationCount;
    const isEncrypted = room.isEncrypted;
    const areNotificationsMuted = room.areNotificationsMuted;
    const typingMembers = room.typingMembers;
    const messages = room.messages;

    function toPlainText(body: string): string {
        try {
            const doc = new DOMParser().parseFromString(body, "text/html");
            return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
        } catch {
            return "";
        }
    }

    function open() {
        selectedRoomStore.set(room);
    }

    $: title = areaName ?? $roomName;
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
    $: latestMessageSender = latestMessage
        ? latestMessage.isMyMessage
            ? $LL.chat.topRow.you()
            : latestMessage.sender?.username ?? $LL.chat.topRow.someone()
        : "";
    $: preview = latestMessageText ? `${latestMessageSender}: ${latestMessageText}` : undefined;
</script>

<div
    class="area-row relative rounded-xl transition-colors {isSelected
        ? 'bg-white/10'
        : $hasUnreadMessages
        ? 'bg-contrast-200/10'
        : ''}"
    data-testid="areaChatRow"
    data-room-id={room.id}
>
    <div class="flex items-center gap-1 pe-1" data-testid={$roomName}>
        <button
            class="group flex min-w-0 grow items-center gap-3 min-h-[3.25rem] m-0 px-3 py-2 rounded-xl text-start hover:bg-contrast-200/10 focus-visible:bg-contrast-200/10"
            on:click={open}
            aria-current={isSelected ? "true" : undefined}
            data-testid="areaChatRowOpen"
        >
            <div class="relative shrink-0" aria-hidden="true">
                <div class="h-8 w-8 rounded-lg p-[2px] bg-gradient-to-br from-secondary/80 to-primary/70">
                    <div class="h-full w-full rounded-md bg-contrast flex items-center justify-center">
                        <IconMapPin
                            font-size="16"
                            class="text-white/85 transition-transform motion-safe:group-hover:-translate-y-0.5"
                        />
                    </div>
                </div>
                {#if $isEncrypted}
                    <EncryptionBadge />
                {/if}
            </div>

            <div class="flex min-w-0 grow flex-col">
                <div
                    class="truncate text-sm {$hasUnreadMessages ? 'text-white font-bold' : 'text-white/85'}"
                    data-testid="areaChatRowTitle"
                >
                    {title}
                </div>
                <div class="flex min-w-0 items-center text-xs text-white/60">
                    <span class="shrink-0 font-semibold text-secondary-400" data-testid="areaChatRowInThisArea"
                        >{$LL.chat.areaRow.inThisArea()}</span
                    >
                    {#if typingLine}
                        <span class="shrink-0" aria-hidden="true">{$LL.chat.topRow.separator()}</span>
                        <span class="truncate text-secondary-400">{typingLine}…</span>
                    {:else if preview}
                        <span class="shrink-0" aria-hidden="true">{$LL.chat.topRow.separator()}</span>
                        <span class="truncate" data-testid="areaChatRowPreview">{preview}</span>
                    {/if}
                </div>
            </div>

            {#if $hasUnreadMessages}
                <div class="flex shrink-0 items-center justify-center min-w-7 h-7 relative">
                    {#if $unreadCount > 0}
                        <span
                            class="min-w-5 h-5 px-1.5 rounded-full bg-secondary text-white text-[11px] font-bold flex items-center justify-center"
                            aria-hidden="true">{$unreadCount > 99 ? "99+" : $unreadCount}</span
                        >
                    {:else}
                        <div class="rounded-full bg-secondary-200 h-2 w-2 motion-safe:animate-ping absolute" />
                        <div class="rounded-full bg-secondary-200 h-1.5 w-1.5 absolute" />
                    {/if}
                    <span class="sr-only">{$LL.chat.areaRow.unread({ count: $unreadCount })}</span>
                </div>
            {/if}
        </button>
        {#if $areNotificationsMuted}
            <IconBellOff font-size="12" class="shrink-0 opacity-50" />
        {/if}
        <RoomMenu {room} />
    </div>
</div>

<style>
    .area-row {
        background-image: linear-gradient(to right, rgb(65 86 246 / 0.14), rgb(134 41 252 / 0.06) 60%, transparent);
    }

    :global([dir="rtl"]) .area-row {
        background-image: linear-gradient(to left, rgb(65 86 246 / 0.14), rgb(134 41 252 / 0.06) 60%, transparent);
    }
</style>
