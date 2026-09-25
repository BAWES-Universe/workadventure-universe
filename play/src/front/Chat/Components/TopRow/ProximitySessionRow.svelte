<script lang="ts">
    import { readable } from "svelte/store";
    import LL, { locale } from "../../../../i18n/i18n-svelte";
    import type { ChatMessage } from "../../Connection/ChatConnection";
    import type { ProximitySession } from "../../Connection/Proximity/ProximitySessions";
    import { ROOM_MESSAGES_SESSION_ID } from "../../Connection/Proximity/ProximitySessions";
    import type { PictureStore } from "../../../Stores/PictureStore";
    import { formatRowTime, formatUnreadCount, toPlainText } from "../OneList/OneListOrder";
    import { minuteClock } from "../OneList/MinuteClock";
    import TopRowAvatar from "./TopRowAvatar.svelte";
    import { IconMapPin, IconScript } from "@wa-icons";

    /**
     * A proximity chat you had, as a row of the chat list: always titled as such (or by the meeting's name),
     * with who was in it underneath. The room messages (from scripts, outside any stay) get a row of their own.
     */
    export let session: ProximitySession<ChatMessage>;
    export let unreadCount = 0;
    export let onOpen: () => void;

    const MAX_AVATARS = 2;

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
            if (message.isMyMessage || !message.sender) continue;
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

    $: isRoomMessages = session.id === ROOM_MESSAGES_SESSION_ID;
    $: title = isRoomMessages ? $LL.chat.session.roomMessages() : session.isArea ? session.label : $LL.chat.proximity();
    $: names = isRoomMessages ? $LL.chat.session.roomMessagesHint() : session.isArea ? "" : session.label;
    $: lastMessage = session.lastMessage;
    $: lastContent = lastMessage?.content;
    $: lastText = $lastContent ? toPlainText($lastContent.body) : "";
    $: lastSender = lastMessage
        ? lastMessage.isMyMessage
            ? $LL.chat.topRow.you()
            : lastMessage.sender?.username ?? $LL.chat.topRow.someone()
        : "";
    $: preview = session.unsentDraft
        ? `${$LL.chat.session.unsentDraft()}: ${toPlainText(session.unsentDraft)}`
        : lastText
        ? `${lastSender}: ${lastText}`
        : "";
    $: talkers = talkersOf(session.messages);
    $: shownTalkers = talkers.slice(0, MAX_AVATARS);
    $: timestamp = lastMessage?.date?.getTime() ?? session.endedAt ?? session.startedAt;
    $: timeLabel = timestamp
        ? formatRowTime(timestamp, $minuteClock, $locale, {
              justNow: $LL.chat.oneList.justNow(),
              minutes: (count) => $LL.chat.oneList.minutesShort({ count }),
              yesterday: $LL.chat.oneList.yesterday(),
          })
        : "";
    $: hasUnread = unreadCount > 0;
</script>

<button
    type="button"
    class="group relative m-0 flex w-full items-center gap-3 min-h-14 ps-2 pe-3 py-2 rounded-xl text-start bg-transparent hover:bg-white/10 focus:outline-none focus-visible:bg-white/10"
    data-testid="proximitySessionRow"
    data-session-id={session.id}
    on:click={onOpen}
>
    <div class="relative h-10 w-10 shrink-0" aria-hidden="true">
        {#if isRoomMessages}
            <div class="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/70">
                <IconScript font-size="20" />
            </div>
        {:else if session.isArea && shownTalkers.length === 0}
            <div class="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/70">
                <IconMapPin font-size="20" />
            </div>
        {:else if shownTalkers.length >= 2}
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
            <TopRowAvatar pictureStore={readable(undefined)} name={title} size="lg" ring={false} />
        {/if}
    </div>
    <div class="flex min-w-0 grow flex-col">
        <div class="flex min-w-0 items-baseline gap-2">
            <span class="min-w-0 grow truncate {hasUnread ? 'text-white font-bold' : 'text-white/90'}">
                <span data-testid="proximitySessionRowTitle">{title}</span>{#if names}<span
                        class="font-normal text-white/50"
                        data-testid="proximitySessionRowNames">{$LL.chat.topRow.separator()}{names}</span
                    >{/if}
            </span>
            {#if timeLabel}
                <span class="shrink-0 text-xs tabular-nums text-white/50">{timeLabel}</span>
            {/if}
        </div>
        <div class="flex min-w-0 items-center gap-2">
            <span
                class="min-w-0 grow truncate text-sm {hasUnread ? 'text-white/85' : 'text-white/60'}"
                data-testid="proximitySessionRowPreview">{preview}</span
            >
            {#if hasUnread}
                <span
                    class="u-badge flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-bold"
                    data-testid="proximitySessionRowUnread">{formatUnreadCount(unreadCount)}</span
                >
            {/if}
        </div>
    </div>
</button>
