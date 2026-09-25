<script lang="ts">
    import { readable } from "svelte/store";
    import LL, { locale } from "../../../../i18n/i18n-svelte";
    import type { ChatMessage } from "../../Connection/ChatConnection";
    import type { ProximitySession } from "../../Connection/Proximity/ProximitySessions";
    import { ROOM_MESSAGES_SESSION_ID } from "../../Connection/Proximity/ProximitySessions";
    import type { PictureStore } from "../../../Stores/PictureStore";
    import { formatRowTime, formatUnreadCount, toPlainText } from "../OneList/OneListOrder";
    import { minuteClock } from "../OneList/MinuteClock";
    import { gameManager } from "../../../Phaser/Game/GameManager";
    import TopRowAvatar from "./TopRowAvatar.svelte";
    import { formatPeopleNames } from "./TopRowSummary";
    import { IconMapPin, IconScript } from "@wa-icons";

    /**
     * A proximity chat you had, as a row of the chat list: titled with who you talked with (or the meeting's name),
     * with a small "Proximity chat" tag, and their wokas. The room messages (from scripts, outside any stay) get a
     * row of their own.
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

    // The people who were in the chat, with their wokas from the world when they're still around.
    const worldUsers = gameManager.getCurrentGameScene().allUsersInWorldStore;

    function findByName(name: string) {
        if (!$worldUsers) return undefined;
        for (const user of $worldUsers.values()) {
            if (user.name === name) return user;
        }
        return undefined;
    }

    function participantsOf(ids: readonly string[], names: readonly string[]): Talker[] {
        return names
            .map((name, index): Talker => {
                const id = ids[index];
                // By id, else by name: someone who reconnected has a new id but the same woka.
                const user = (id ? $worldUsers?.get(id) : undefined) ?? findByName(name);
                return {
                    key: id ?? name,
                    name,
                    pictureStore: user?.pictureStore ?? readable<string | undefined>(undefined),
                };
            })
            .filter((person) => person.name.trim() !== "");
    }

    $: isRoomMessages = session.id === ROOM_MESSAGES_SESSION_ID;
    $: participants = participantsOf(session.participantIds, session.participants);
    $: peopleNames = formatPeopleNames(
        participants.length > 0
            ? participants.map((person) => person.name)
            : talkersOf(session.messages).map((t) => t.name),
        { two: $LL.chat.topRow.twoNames, more: $LL.chat.topRow.moreNames }
    );
    $: title = isRoomMessages
        ? $LL.chat.session.roomMessages()
        : session.isArea
        ? session.label
        : peopleNames || $LL.chat.proximity();
    $: kind = isRoomMessages
        ? $LL.chat.session.roomMessagesTag()
        : session.isArea
        ? $LL.chat.session.meetingTag()
        : $LL.chat.session.proximityTag();
    $: lastMessage = session.lastMessage;
    $: lastContent = lastMessage?.content;
    $: lastText = $lastContent ? toPlainText($lastContent.body) : "";
    $: lastSender = lastMessage
        ? lastMessage.isMyMessage
            ? $LL.chat.topRow.you()
            : lastMessage.sender?.username ?? $LL.chat.topRow.someone()
        : "";
    // Like a DM row: the sender's name is left out when the title already names them alone.
    // "You:" stays, and so do names when several people were in the chat.
    $: senderIsTitle =
        lastMessage !== undefined &&
        !lastMessage.isMyMessage &&
        (lastMessage.sender?.username ?? "").trim() === title.trim();
    $: preview = session.unsentDraft
        ? `${$LL.chat.session.unsentDraft()}: ${toPlainText(session.unsentDraft)}`
        : lastText
        ? senderIsTitle
            ? lastText
            : `${lastSender}: ${lastText}`
        : "";
    // Wokas: the people who wrote, else the people who were there.
    $: talkers = withWorldPictures(talkersOf(session.messages), participants);
    $: shownTalkers = (talkers.length > 0 ? talkers : participants).slice(0, MAX_AVATARS);

    function withWorldPictures(list: Talker[], people: Talker[]): Talker[] {
        return list.map((talker) => {
            const known = people.find((person) => person.name === talker.name);
            return known ? { ...talker, pictureStore: known.pictureStore } : talker;
        });
    }
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
            <span
                class="min-w-0 grow truncate {hasUnread ? 'text-white font-bold' : 'text-white/90'}"
                data-testid="proximitySessionRowTitle">{title}</span
            >
            {#if timeLabel}
                <span class="shrink-0 text-xs tabular-nums text-white/50">{timeLabel}</span>
            {/if}
        </div>
        <div class="flex min-w-0 items-center gap-2">
            <span
                class="min-w-0 grow truncate text-sm {hasUnread ? 'text-white/85' : 'text-white/60'}"
                data-testid="proximitySessionRowPreview">{preview}</span
            >
            <!-- What kind of chat this was, under the time, where DM rows keep their menu. -->
            <span class="session-tag shrink-0" data-testid="proximitySessionRowKind">{kind}</span>
            {#if hasUnread}
                <span
                    class="u-badge flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-bold"
                    data-testid="proximitySessionRowUnread">{formatUnreadCount(unreadCount)}</span
                >
            {/if}
        </div>
    </div>
</button>

<style>
    /* What kind of chat this was, as a small tag at the end of the preview line. */
    .session-tag {
        display: inline-flex;
        align-items: center;
        height: 1.125rem;
        padding: 0 0.4rem;
        border-radius: 999px;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.02em;
        color: #d8ccff;
        background: rgb(134 41 252 / 0.22);
        border: 1px solid rgb(167 139 250 / 0.3);
    }
</style>
