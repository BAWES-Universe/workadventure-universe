<script lang="ts" context="module">
    // One report a page load of how the chat stands once the keyboard has closed (see reportAfterKeyboard).
    let keyboardCloseReported = false;
</script>

<script lang="ts">
    import { afterUpdate, beforeUpdate, hasContext, onDestroy, onMount, setContext, tick } from "svelte";
    import * as Sentry from "@sentry/svelte";
    import { derived, get, readable, writable } from "svelte/store";
    import type { Readable } from "svelte/store";
    import { gameManager } from "../../../Phaser/Game/GameManager";
    import type { ChatMessage, ChatRoom, ChatRoomMembershipManagement } from "../../Connection/ChatConnection";
    import getCloseImg from "../../images/get-close.png";
    import { selectedChatMessageToReply, shouldRestoreChatStateStore } from "../../Stores/ChatStore";
    import { selectedRoomStore } from "../../Stores/SelectRoomStore";
    import { matrixSecurity } from "../../Connection/Matrix/MatrixSecurity";
    import { localUserStore } from "../../../Connection/LocalUserStore";
    import { ProximityChatRoom } from "../../Connection/Proximity/ProximityChatRoom";
    import type {
        ProximitySession,
        ProximitySessionMarker,
        TimelineEntry,
    } from "../../Connection/Proximity/ProximitySessions";
    import {
        sessionOfStay,
        ROOM_MESSAGES_SESSION_ID,
        buildTimelineEntries,
    } from "../../Connection/Proximity/ProximitySessions";
    import { selectedProximitySessionStore } from "../../Stores/ProximitySessionStore";
    import LL, { locale } from "../../../../i18n/i18n-svelte";
    import { formatPeopleNames } from "../TopRow/TopRowSummary";
    import { availabilityFromNote, botChatClosed, botHeaderState, botIdFromChatId } from "../../Bots/BotChatStatus";
    import { botStatusCache } from "../../Bots/BotStatusStore";
    import { nextReplyLimitExpiry, shownReplyLimitIds } from "../../Bots/BotReplyLimit";
    import BotStatusNoteCard from "../Bots/BotStatusNoteCard.svelte";
    import BotReplyLimitCard from "../Bots/BotReplyLimitCard.svelte";
    import {
        PERSON_COLOUR_CONTEXT,
        NAME_BY_CHAT_ID_CONTEXT,
        WOKA_BY_CHAT_ID_CONTEXT,
        createColourByChatIdStore,
        createNameByChatIdStore,
        createWokaByChatIdStore,
        personColour,
    } from "../../Stores/ChatUserWokaStore";
    import type { PersonColourOf } from "../../Stores/ChatUserWokaStore";
    import { currentChatPeople } from "../../Stores/ChatPeopleLookup";
    import Avatar from "../Avatar.svelte";
    import { MatrixChatRoom } from "../../Connection/Matrix/MatrixChatRoom";
    import { openProfileRoomIdStore } from "../../Stores/PartnerProfileStore";
    import { openRoomDetailsIdStore, openSharedItemsStore } from "../../Stores/ChatDetailsStore";
    import { chatCarriesItsCloseStore } from "../../ChatSidebarWidthStore";
    import { installStrayFileDropGuard, isFileDrag } from "../../../Utils/strayFileDropGuard";
    import { mapEditorToolbarInUseStore } from "../../../Stores/MapEditorStore";
    import { isTouchScreen, SETTLE_CHECKS_MS } from "../../../Utils/ViewportGuard";
    import { ARTIFACT_CHAT_CONTEXT, type ArtifactChatOf } from "../../../Artifacts/artifactChatContext";
    import Message from "./Message.svelte";
    import {
        firstShowingIndex,
        keyboardClosed,
        listGrewTaller,
        placeAfterMove,
        stillPinnedToBottom,
    } from "./TimelinePin";
    import MessageInputBar from "./MessageInputBar.svelte";
    import MessageSystem from "./MessageSystem.svelte";
    import CopiedPill from "./MessageActions/CopiedPill.svelte";
    import SessionDivider from "./Thread/SessionDivider.svelte";
    import ProximityThreadTitle from "./Thread/ProximityThreadTitle.svelte";
    import ProximityEndedFooter from "./Thread/ProximityEndedFooter.svelte";
    import RoomMenu from "./RoomMenu/RoomMenu.svelte";
    import DirectChatTitle from "./DirectChat/DirectChatTitle.svelte";
    import PartnerProfilePanel from "./DirectChat/PartnerProfilePanel.svelte";
    import RoomDetailsPanel from "./Details/RoomDetailsPanel.svelte";
    import SharedPanel from "./Details/SharedPanel.svelte";
    import PinnedBar from "./Details/PinnedBar.svelte";
    import { DIRECT_PARTNER_CONTEXT, directPartnerStore, type DirectPartner } from "./DirectChat/DirectPartnerStore";
    import { dayLabel, messageRuns, runSenderKey } from "./MessageRuns";
    import { IconChevronLeft, IconChevronRight, IconLoader, IconLock, IconMailBox } from "@wa-icons";

    export let room: ChatRoom;

    // Messages show the sender's woka when their chat account has no picture (Matrix users).
    if (!hasContext(WOKA_BY_CHAT_ID_CONTEXT)) {
        setContext(
            WOKA_BY_CHAT_ID_CONTEXT,
            createWokaByChatIdStore(gameManager.getCurrentGameScene().userProviderMerger, currentChatPeople()?.store)
        );
    }
    // A direct chat names the other person as they go by in Universe (header and profile).
    if (!hasContext(NAME_BY_CHAT_ID_CONTEXT)) {
        setContext(
            NAME_BY_CHAT_ID_CONTEXT,
            createNameByChatIdStore(gameManager.getCurrentGameScene().userProviderMerger, currentChatPeople()?.store)
        );
    }

    // Cards inside messages (a bot's room) act on the other person of a direct chat.
    const partnerForCards = writable<DirectPartner | undefined>(undefined);
    setContext<Readable<DirectPartner | undefined>>(DIRECT_PARTNER_CONTEXT, partnerForCards);

    // An artifact card opens its artifact from the chat it is in, which the game's server checks: the bubble's space,
    // or the Matrix room of a direct chat. Asked when the card is tapped, since a bubble's space changes over time.
    setContext<ArtifactChatOf>(ARTIFACT_CHAT_CONTEXT, () => {
        if (room instanceof ProximityChatRoom) {
            const ref = room.currentSpaceName;
            return ref ? { kind: "nearby", ref } : undefined;
        }
        return room instanceof MatrixChatRoom && room.type === "direct" ? { kind: "dm", ref: room.id } : undefined;
    });

    // In a direct chat, each person's woka sits on their colour from People (header, profile, messages).
    const isDirectChat = writable(false);
    const colourByChatId = createColourByChatIdStore(gameManager.getCurrentGameScene().userProviderMerger);
    setContext<Readable<PersonColourOf>>(
        PERSON_COLOUR_CONTEXT,
        derived([isDirectChat, colourByChatId], ([$isDirectChat, $colourByChatId]) =>
            $isDirectChat
                ? (chatId: string | undefined, name: string | undefined) => personColour($colourByChatId, chatId, name)
                : () => undefined
        )
    );

    const chatConnection = gameManager.chatConnection;
    const shouldRetrySendingEvents = chatConnection.shouldRetrySendingEvents;
    let myChatID = localUserStore.getChatId();

    let messageListRef: HTMLDivElement;
    let messageListContentRef: HTMLUListElement;
    let autoScroll = true;
    // True while the reader is at the newest message (see TimelinePin). While it is, the list stays on the newest
    // message whatever changes size: a picture or GIF that finishes loading, older history coming in above, the sheet.
    let pinnedToBottom = true;
    let lastScrollTop = 0;
    // Messages can change height long after they are drawn (pictures, GIFs, link cards, reactions), and none of that
    // re-renders this list, so the sizes are watched instead.
    let resizeObserver: ResizeObserver | undefined;
    // Until when a smooth scroll to the bottom is still sliding (a smooth scroll lasts about this long).
    const SMOOTH_SCROLL_MS = 500;
    let smoothScrollUntil = 0;
    let newestMessageId: string | undefined;
    let childListObserver: MutationObserver | undefined;
    // The list's own height at its last size change and the window's at its last resize, to see them grow (see
    // redrawList).
    let lastListHeight = 0;
    let lastWindowHeight = window.innerHeight;
    const touchScreen = isTouchScreen(window);
    let reportAfterRedraw = false;
    let redrawFrame: number | undefined;
    let redrawTimer: ReturnType<typeof setTimeout> | undefined;
    // Where the list was put back after the last redraw: if it has moved since, a scroll has drawn it again already.
    let placeAfterRedraw: number | undefined;
    // After the keyboard closes, once the page is back in place (ViewportGuard's last check), with a little margin.
    const REDRAW_AFTER_SETTLE_MS = SETTLE_CHECKS_MS[SETTLE_CHECKS_MS.length - 1] + 100;

    // Whether the browser keeps the reader's place by itself when something above changes height (scroll anchoring:
    // Chrome, Firefox, Edge, Safari 27). It does that inside its own scrolling, so a flick on a phone keeps gliding.
    // Older Safari doesn't: there the timeline keeps the place itself (readingPlace).
    const browserKeepsPlace = typeof CSS !== "undefined" && CSS.supports?.("overflow-anchor", "auto") === true;

    // Older Safari: the message the reader is looking at while scrolled up, and where it sits in the list's content.
    // When something above it changes height (a picture loading), the list moves by as much, so the reader stays on it.
    let readingPlace: { id: string; contentTop: number; scrollTop: number } | undefined;

    // The message showing at the top of the list just before the list is drawn again, and how far its bottom is from
    // the list's top (see holdPlaceAfterUpdate).
    let placeBeforeUpdate: { id: string; bottom: number } | undefined;

    let loadingMessagePromise: Promise<void> | undefined = undefined;

    let scrollTimer: ReturnType<typeof setTimeout>;
    let shouldDisplayLoader = false;
    // False until the chat's first messages are in and it sits at the bottom. Until then the list stays hidden
    // (it is still measured) behind a spinner, so the chat opens already filled instead of building up on screen.
    let initialLoadDone = false;

    let messageInputBarRef: MessageInputBar;

    const gameScene = gameManager.getCurrentGameScene();
    const chatRoomsEnableInAdmin = gameScene.room.isChatEnabled;
    const direction = document.documentElement.getAttribute("dir") || "ltr";

    $: messages = room?.messages;
    $: roomName = room?.name;
    $: isEncrypted = room.isEncrypted;
    $: proximityRoom = room instanceof ProximityChatRoom ? room : undefined;
    $: matrixRoom = room instanceof MatrixChatRoom ? room : undefined;

    // Counts the chat objects shown here: a chat can be made again under the same id (its type found out later, or a new
    // map), and what is keyed on this is made again with it. A number, so the same chat set again changes nothing.
    let roomInstance = 0;
    let lastRoom: ChatRoom | undefined = room;
    $: if (room !== lastRoom) {
        lastRoom = room;
        roomInstance++;
    }
    // A direct chat knows who the other person is and where they are right now (header, menu, profile).
    $: directPartner = matrixRoom?.type === "direct" ? directPartnerStore(matrixRoom) : undefined;
    $: profileOpen = directPartner !== undefined && $openProfileRoomIdStore === room.id;
    // A group's details, and the page of what a chat shared over either, sit over the conversation like the profile.
    $: roomDetailsOpen = matrixRoom !== undefined && directPartner === undefined && $openRoomDetailsIdStore === room.id;
    $: sharedOpen =
        matrixRoom !== undefined && $openSharedItemsStore?.roomId === room.id ? $openSharedItemsStore : undefined;
    $: isDirectChat.set(directPartner !== undefined);
    $: partnerForCards.set(directPartner ? $directPartner : undefined);
    $: roomMembers = matrixRoom ? matrixRoom.members : readable([]);
    $: memberCount = $roomMembers.length;
    // The proximity chat is one timeline across every stay. The thread shows one stay at a time: the live one,
    // or an ended one from the list (read-only). With no stay selected, the whole timeline shows with dividers,
    // as it always did. Other rooms have no session markers.
    $: spaceJoinedAt = proximityRoom ? proximityRoom.spaceJoinedAt : readable(undefined);
    $: sessions = proximityRoom ? proximityRoom.sessions : readable([] as ProximitySession<ChatMessage>[]);
    $: shownSession = proximityRoom
        ? $selectedProximitySessionStore !== undefined
            ? sessionOfStay($sessions, $selectedProximitySessionStore)
            : undefined
        : undefined;
    $: liveSession = proximityRoom ? $sessions.find((session) => session.isLive) : undefined;
    $: isEnded = shownSession !== undefined && !shownSession.isLive;
    $: isRoomMessages = shownSession?.id === ROOM_MESSAGES_SESSION_ID;
    $: timelineEntries = shownSession
        ? (shownSession.entries as TimelineEntry<ChatMessage & { session?: ProximitySessionMarker }>[])
        : buildTimelineEntries($messages as (ChatMessage & { session?: ProximitySessionMarker })[], $spaceJoinedAt);
    function isNoticeEntry(entry: TimelineEntry<ChatMessage & { session?: ProximitySessionMarker }>): boolean {
        return (
            ((entry.role === "start" || entry.role === "resume") && entry.message.session !== undefined) ||
            entry.message.type === "outcoming" ||
            entry.message.type === "incoming"
        );
    }
    // Runs. Dividers and notices (someone joining) end a run.
    $: runs = messageRuns(
        timelineEntries.map((entry) => {
            const message = entry.message;
            const isNotice = isNoticeEntry(entry);
            return {
                id: message.id,
                date: message.date,
                senderKey: isNotice ? undefined : message.isMyMessage ? "me" : runSenderKey(message.sender),
                isReply: message.quotedMessage !== undefined,
            };
        })
    );
    // Notices keep the spacing they had before the run labels: room above them after a message (the message row used
    // to end with its own), and nothing added below them.
    $: noticeFlags = timelineEntries.map(isNoticeEntry);
    $: endedTitle = shownSession
        ? isRoomMessages
            ? $LL.chat.session.roomMessages()
            : shownSession.isArea
            ? shownSession.label
            : $LL.chat.proximity()
        : "";
    $: endedSubtitle = (() => {
        if (!shownSession) return "";
        if (isRoomMessages) return $LL.chat.session.roomMessagesHint();
        const parts: string[] = [];
        if (!shownSession.isArea) {
            const names = formatPeopleNames(shownSession.participants, {
                two: $LL.chat.topRow.twoNames,
                more: $LL.chat.topRow.moreNames,
            });
            if (names) parts.push($LL.chat.thread.withPeople({ names }));
        }
        if (shownSession.endedAt) {
            const time = new Date(shownSession.endedAt).toLocaleTimeString($locale, {
                hour: "2-digit",
                minute: "2-digit",
            });
            parts.push($LL.chat.session.endedAt({ time }));
        }
        return parts.join($LL.chat.topRow.separator());
    })();
    // Someone walked up while you were reading an ended stay: your view stays, a small notice offers the live one.
    $: liveElsewhere = isEnded && liveSession !== undefined;
    $: liveNotice = liveSession
        ? liveSession.isArea
            ? $LL.chat.session.liveNowArea({ name: liveSession.label })
            : $LL.chat.session.liveNow({
                  names: formatPeopleNames(liveSession.participants, {
                      two: $LL.chat.topRow.twoNames,
                      more: $LL.chat.topRow.moreNames,
                  }),
              })
        : "";
    $: isEmptyProximityView = shownSession !== undefined && shownSession.messages.length === 0;
    // The proximity chat is in memory: it has nothing to wait for and keeps its own empty states.
    $: isLoadingMessages = room?.isLoadingMessages ?? readable(false);
    $: firstFillPending = !proximityRoom && !initialLoadDone;
    $: showLoading = !proximityRoom && (!initialLoadDone || ($isLoadingMessages && $messages.length === 0));

    // A direct chat with a bot shows the bot's state under its name and in the message box. The state comes from the bot
    // server. The bot's account being out of the room does not mean it was deleted: it also leaves when it declines an
    // invite (resting, not ready, no access). So the chat closes only when the state, or the bot's own goodbye note, says
    // it is gone.
    $: members = "members" in room ? (room as ChatRoom & ChatRoomMembershipManagement).members : readable([]);
    $: partner = room.type === "direct" ? $members.find((member) => member.id !== myChatID) : undefined;
    $: partnerBotId = botIdFromChatId(partner?.id);
    $: partnerMembership = partner?.membership ?? readable(undefined);
    $: botLeft = partnerBotId !== undefined && $partnerMembership === "leave";
    $: botAvailability = partnerBotId ? botStatusCache.store(partnerBotId) : readable(undefined);
    $: botState = partnerBotId ? $botAvailability : undefined;
    $: botClosed = botChatClosed(botState);
    $: lastBotMessage = partnerBotId ? [...$messages].reverse().find((message) => !message.isMyMessage) : undefined;
    $: lastBotNote = lastBotMessage?.botStatus;
    // One reply limit card per bot (#1159): the newest, and only until its time is up. The clock moves on when the next
    // card runs out, so it goes away then even when nothing new is said.
    let replyLimitNow = Date.now();
    let replyLimitTimer: ReturnType<typeof setTimeout> | undefined;
    $: shownReplyLimits = shownReplyLimitIds($messages, replyLimitNow);
    $: wakeAtReplyLimitExpiry(nextReplyLimitExpiry($messages, replyLimitNow));
    function wakeAtReplyLimitExpiry(expiry: number | undefined) {
        clearTimeout(replyLimitTimer);
        replyLimitTimer = undefined;
        if (expiry === undefined) return;
        replyLimitTimer = setTimeout(tickReplyLimitClock, Math.min(expiry - Date.now() + 50, 2 ** 31 - 1));
    }
    function tickReplyLimitClock() {
        replyLimitNow = Date.now();
    }
    // A note saying the bot is resting, not ready or gone updates the header at once, unless a lookup that started after
    // the note was written knows better.
    $: lastNoteAvailability = lastBotNote ? availabilityFromNote(lastBotNote.state) : undefined;
    $: noteWrittenAt = lastBotMessage?.botStatusAt ?? lastBotMessage?.date?.getTime();
    $: if (partnerBotId && lastNoteAvailability && noteWrittenAt !== undefined) {
        botStatusCache.learn(partnerBotId, lastNoteAvailability, noteWrittenAt);
    }
    $: shownBotState = botHeaderState(botState, lastBotNote?.state);
    $: botPlaceholder =
        botState === "resting"
            ? $LL.chat.botStatus.restingPlaceholder()
            : botState === "unready"
            ? $LL.chat.botStatus.unreadyPlaceholder()
            : undefined;
    // The bot's account is out of the room and the bot is gone: say so once, as for a person leaving.
    $: botLeftLine =
        botLeft && botClosed
            ? {
                  date: null,
                  content: readable({
                      body: $LL.chat.botStatus.left({ name: $roomName }),
                      url: undefined,
                      urls: undefined,
                      filename: undefined,
                      fileNames: undefined,
                  }),
              }
            : undefined;

    onMount(() => {
        installStrayFileDropGuard();
        watchSizes();
        initMessages()
            .catch((error) => console.error(error))
            .finally(() => {
                // The first time, jump to the bottom while the list is still hidden, then show it. Every chat opens
                // on its newest message at once, with no slide, as chat apps do.
                scrollToMessageListBottom();
                // The proximity chat has no first fill.
                if (!proximityRoom) initialLoadDone = true;
            });
    });

    // Resolves once the room has its first messages (at once for a room with nothing to wait for).
    async function waitForRoomToLoad() {
        if (!get(isLoadingMessages)) return;
        let unsubscribe = () => {};
        await new Promise<void>((resolve) => {
            unsubscribe = isLoadingMessages.subscribe((loading) => {
                if (!loading) resolve();
            });
        });
        unsubscribe();
    }

    async function initMessages() {
        if (!messageListRef) return;

        const loadMessages = async () => {
            try {
                if (get(room.isEncrypted) && get(matrixSecurity.isEncryptionRequiredAndNotSet)) {
                    return;
                }

                // The room loads its first messages itself: take what it has, and ask for more only if the screen
                // is not filled yet (a chat that already has enough opens with no request at all).
                await waitForRoomToLoad();
                await tick();
                while (messageListRef && get(room.hasPreviousMessage) && isViewportNotFilled()) {
                    const messageCount = get(room.messages).length;
                    // eslint-disable-next-line no-await-in-loop
                    await room.loadMorePreviousMessages();
                    // eslint-disable-next-line no-await-in-loop
                    await tick();
                    // Nothing came back: stop rather than ask again and again.
                    if (get(room.messages).length === messageCount) break;
                }
            } catch (error) {
                console.error(`Failed to load messages: ${error}`);
            }
        };

        try {
            await loadMessages();
            scrollToMessageListBottom();
        } catch (error) {
            console.error(`Failed to load messages: ${error}`);
        }
    }

    beforeUpdate(() => {
        if (messageListRef) {
            const scrollableDistance = messageListRef.scrollHeight - messageListRef.offsetHeight;
            autoScroll = pinnedToBottom || messageListRef.scrollTop > scrollableDistance - 20;
            placeBeforeUpdate = autoScroll || firstFillPending ? undefined : topMessagePlace();
        }
    });

    afterUpdate(() => {
        room.setTimelineAsRead();
        // While the list is hidden for its first fill, it is scrolled once, when it is done.
        if (firstFillPending) return;
        // A message you just sent always shows, even if you had scrolled up (a GIF alone has no text to report it).
        const newest = $messages[$messages.length - 1];
        const isNewMessage = newest !== undefined && newestMessageId !== undefined && newest.id !== newestMessageId;
        newestMessageId = newest?.id;
        if (autoScroll || (isNewMessage && newest?.isMyMessage === true)) {
            // Only a new message slides in. Anything else (older messages coming in above, the list drawn again)
            // keeps the newest message in place before the screen is drawn, so nothing is seen moving.
            scrollToMessageListBottom(isNewMessage);
        } else {
            holdPlaceAfterUpdate();
        }
    });

    function isSliding(): boolean {
        return performance.now() < smoothScrollUntil;
    }

    function scrollToMessageListBottom(smooth = false) {
        // Safety check for undefined reference
        // After disposing the component, the reference can be undefined
        if (messageListRef == undefined) return;
        // Going to the newest message (your own message sent, the chat opened): stay there while it grows, too.
        pinnedToBottom = true;
        // A new message is still sliding in: aim that slide at the new bottom instead of cutting it short.
        const slide = smooth || isSliding();
        if (slide) smoothScrollUntil = performance.now() + SMOOTH_SCROLL_MS;
        messageListRef.scroll({ top: messageListRef.scrollHeight, behavior: slide ? "smooth" : "auto" });
    }

    // The message showing at the top of the list.
    function topMessage(listTop: number): Element | undefined {
        const items = messageListContentRef.children;
        const index = firstShowingIndex(items.length, (i) => items[i].getBoundingClientRect().bottom, listTop);
        return index === undefined ? undefined : items[index];
    }

    function topMessagePlace(): { id: string; bottom: number } | undefined {
        if (!messageListRef || !messageListContentRef) return undefined;
        const listTop = messageListRef.getBoundingClientRect().top;
        const item = topMessage(listTop);
        const id = item instanceof HTMLElement ? item.dataset.eventId : undefined;
        return item && id ? { id, bottom: item.getBoundingClientRect().bottom - listTop } : undefined;
    }

    // The list was drawn again while the reader is scrolled up (older messages added above, a message gone): the
    // message they were looking at goes back to where it was on screen. Measured just before and just after, so only
    // what the browser has not already put right is moved, and a scroll of the reader's is never undone. By its bottom:
    // with older messages from the same day and person above it now, it loses its day label and name line at its top.
    // This also covers the very top of the list, where browsers don't keep the place.
    function holdPlaceAfterUpdate() {
        const before = placeBeforeUpdate;
        placeBeforeUpdate = undefined;
        if (before && messageListRef && messageListContentRef) {
            const item = messageListContentRef.querySelector<HTMLElement>(
                `:scope > li[data-event-id="${CSS.escape(before.id)}"]`
            );
            if (item) {
                const moved =
                    item.getBoundingClientRect().bottom - messageListRef.getBoundingClientRect().top - before.bottom;
                if (Math.abs(moved) >= 1) messageListRef.scrollTop += moved;
            }
        }
        if (!browserKeepsPlace) rememberReadingPlace();
    }

    // Remembers the message showing at the top of the list, and where it is in the list's content.
    function rememberReadingPlace() {
        if (!messageListRef || !messageListContentRef) return;
        const listTop = messageListRef.getBoundingClientRect().top;
        const item = topMessage(listTop);
        const id = item instanceof HTMLElement ? item.dataset.eventId : undefined;
        readingPlace =
            item && id
                ? {
                      id,
                      contentTop: item.getBoundingClientRect().top - listTop + messageListRef.scrollTop,
                      scrollTop: messageListRef.scrollTop,
                  }
                : undefined;
    }

    // Older Safari: while the reader is scrolled up, keeps the message they were looking at where it was when something
    // above it changed height.
    function keepReadingPlace() {
        if (!messageListRef || !messageListContentRef) return;
        const item =
            !pinnedToBottom && readingPlace
                ? messageListContentRef.querySelector<HTMLElement>(
                      `:scope > li[data-event-id="${CSS.escape(readingPlace.id)}"]`
                  )
                : null;
        if (item && readingPlace) {
            const listTop = messageListRef.getBoundingClientRect().top;
            const contentTop = item.getBoundingClientRect().top - listTop + messageListRef.scrollTop;
            const moved = contentTop - readingPlace.contentTop;
            if (Math.abs(moved) >= 1) {
                const list = messageListRef;
                list.scrollTop = placeAfterMove(
                    list.scrollTop,
                    readingPlace.scrollTop,
                    list.scrollHeight - list.clientHeight,
                    moved
                );
            }
        }
        rememberReadingPlace();
    }

    function watchSizes() {
        if (typeof ResizeObserver === "undefined" || !messageListRef || !messageListContentRef) return;
        resizeObserver = new ResizeObserver(() => {
            const sliding = isSliding();
            // At the newest message: stay on it, before the screen is drawn. Scrolled up: stay on what is read (the
            // browser does that itself where it can).
            if (pinnedToBottom) scrollToMessageListBottom();
            else if (!browserKeepsPlace) keepReadingPlace();
            const height = messageListRef?.clientHeight ?? 0;
            if (touchScreen && !sliding && listGrewTaller(lastListHeight, height)) redrawAfterGrowing();
            lastListHeight = height;
        });
        // The list itself (the sheet changes height) and each message in it.
        resizeObserver.observe(messageListRef);
        for (const item of Array.from(messageListContentRef.children)) resizeObserver.observe(item);
        childListObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of Array.from(mutation.addedNodes)) {
                    if (node instanceof Element) resizeObserver?.observe(node);
                }
                for (const node of Array.from(mutation.removedNodes)) {
                    if (node instanceof Element) resizeObserver?.unobserve(node);
                }
            }
        });
        childListObserver.observe(messageListContentRef, { childList: true });
    }

    // The keyboard closing gives the window its height back (the app resizes itself: ViewportResync).
    function onWindowResize() {
        const height = window.innerHeight;
        const closed = keyboardClosed(lastWindowHeight, height);
        lastWindowHeight = height;
        if (!touchScreen || !closed) return;
        if (!keyboardCloseReported) reportAfterRedraw = true;
        redrawAfterGrowing();
    }

    // Now, and once more after the page has settled from the keyboard.
    function redrawAfterGrowing() {
        redrawList();
        clearTimeout(redrawTimer);
        redrawTimer = setTimeout(() => {
            if (reportAfterRedraw) reportAfterKeyboard();
            // Not under a finger scrolling it: that scroll has drawn it again already.
            if (messageListRef?.scrollTop === placeAfterRedraw) redrawList();
        }, REDRAW_AFTER_SETTLE_MS);
    }

    // iPhone: when the keyboard closes and the sheet gets its height back, the list can stay drawn where it was with
    // the keyboard up: the newest message cut off at the top over an empty band, until a finger scrolls it. Taking
    // its scrolling away for one frame and giving it back makes the phone lay it out and draw it again where it is.
    function redrawList() {
        if (!messageListRef || redrawFrame !== undefined) return;
        const list = messageListRef;
        const place = list.scrollTop;
        list.style.overflow = "hidden";
        redrawFrame = requestAnimationFrame(() => {
            redrawFrame = undefined;
            list.style.overflow = "";
            list.scrollTop = pinnedToBottom ? list.scrollHeight : place;
            placeAfterRedraw = list.scrollTop;
        });
    }

    // Logging over asking for console lines: the real sizes on a phone once the keyboard has closed, so a gap left
    // after it can be told apart (the list laid out too short, or laid out right and drawn at its old place).
    function reportAfterKeyboard() {
        reportAfterRedraw = false;
        if (keyboardCloseReported || !messageListRef) return;
        keyboardCloseReported = true;
        const list = messageListRef.getBoundingClientRect();
        const viewport = window.visualViewport;
        Sentry.captureMessage("Chat sizes after the phone keyboard closed (#1128)", {
            level: "info",
            extra: {
                innerHeight: window.innerHeight,
                viewportHeight: viewport?.height,
                viewportOffsetTop: viewport?.offsetTop,
                pageTop: viewport?.pageTop,
                scrollY: window.scrollY,
                sheetHeight: document.getElementById("chat")?.getBoundingClientRect().height,
                timelineHeight: timelineRef?.getBoundingClientRect().height,
                listTop: list.top,
                listBottom: list.bottom,
                listClientHeight: messageListRef.clientHeight,
                listScrollHeight: messageListRef.scrollHeight,
                listScrollTop: messageListRef.scrollTop,
                messagesBottom: messageListContentRef?.getBoundingClientRect().bottom,
                composerTop: timelineRef?.lastElementChild?.getBoundingClientRect().top,
                pinnedToBottom,
            },
        });
    }

    function updatePinnedToBottom() {
        if (!messageListRef) return;
        pinnedToBottom = stillPinnedToBottom(pinnedToBottom, lastScrollTop, messageListRef);
        lastScrollTop = messageListRef.scrollTop;
    }

    function goBackAndClearSelectedChatMessage() {
        openProfileRoomIdStore.set(undefined);
        openRoomDetailsIdStore.set(undefined);
        openSharedItemsStore.set(undefined);
        selectedChatMessageToReply.set(null);
        selectedRoomStore.set(undefined);
        shouldRestoreChatStateStore.set(false);
    }

    function handleScroll() {
        updatePinnedToBottom();
        // Something above may have changed height in this same frame: put that right before taking the new place.
        if (!browserKeepsPlace) keepReadingPlace();
        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(() => {
            loadMorePreviousMessages();
        }, 100);
    }

    function loadMorePreviousMessages() {
        if (loadingMessagePromise || !shouldLoadMoreMessages()) return;

        loadingMessagePromise = new Promise<void>((resolve) => {
            (async () => {
                const loadMessages = async () => {
                    if (messageListRef.scrollTop === 0) {
                        shouldDisplayLoader = true;
                    }
                    await room.loadMorePreviousMessages();

                    if (shouldLoadMoreMessages()) {
                        loadMorePreviousMessages();
                    }
                };

                await loadMessages();
            })()
                .catch((error) => {
                    console.error(`Failed to load messages: ${error}`);
                    throw new Error(`Failed to load messages: ${error}`);
                })
                .finally(() => {
                    if (shouldDisplayLoader) {
                        shouldDisplayLoader = false;
                    }
                    resolve();
                });
        }).finally(() => {
            loadingMessagePromise = undefined;
        });
    }

    function shouldLoadMoreMessages() {
        const messages = Array.from(messageListRef?.querySelectorAll("li") || []);
        // The first message showing at the top of the list. The list can start halfway down the screen (the phone
        // sheet), so it is measured from the list's own top, not the screen's.
        const listTop = messageListRef?.getBoundingClientRect().top ?? 0;
        const messagesBeforeViewportTop = messages.find((msg) => msg.getBoundingClientRect().top >= listTop);

        return (
            messagesBeforeViewportTop &&
            messages.indexOf(messagesBeforeViewportTop) < 10 &&
            messages.indexOf(messagesBeforeViewportTop) !== -1 &&
            get(room.hasPreviousMessage)
        );
    }

    function isViewportNotFilled() {
        return messageListRef.scrollHeight <= messageListRef.clientHeight;
    }

    function onUpdateMessageBody(event: CustomEvent) {
        if (firstFillPending) return;
        if (
            pinnedToBottom ||
            (event.detail != undefined &&
                $messages.length > 0 &&
                event.detail.id === $messages[$messages.length - 1].id &&
                $messages[$messages.length - 1].sender?.chatId === myChatID)
        ) {
            // At the newest message, its text showing stays put; from higher up, your own message slides in.
            scrollToMessageListBottom(!pinnedToBottom);
        }
    }

    function onDropFiles(event: DragEvent) {
        endFileDrag();
        if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
            messageInputBarRef?.handleFiles({
                detail: event.dataTransfer.files,
            } as CustomEvent<FileList>);
        }
    }

    // While this conversation is open, a file dropped anywhere in the window goes into its message box, and the
    // conversation lights up while the file is dragged. Whatever takes a drop itself first (the map in edit mode, an
    // upload box) keeps it. Nothing is sent until Send, as with a drop on the conversation itself.
    let timelineRef: HTMLDivElement;
    let fileDragOver = false;
    let fileDragTimer: ReturnType<typeof setTimeout> | undefined;

    function takesFileDrop(event: DragEvent): boolean {
        if (!isFileDrag(event) || isEnded || !messageInputBarRef) return false;
        return !event.defaultPrevented || (event.target instanceof Node && timelineRef?.contains(event.target));
    }

    function endFileDrag() {
        fileDragOver = false;
        clearTimeout(fileDragTimer);
    }

    function onDocumentDragOver(event: DragEvent) {
        if (!takesFileDrop(event)) return;
        acceptFileDrag(event);
    }

    function acceptFileDrag(event: DragEvent) {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
        fileDragOver = true;
        // Dragover repeats while a file is held over the window. When it stops coming, the file has gone somewhere
        // that takes it itself, or out of the window.
        clearTimeout(fileDragTimer);
        fileDragTimer = setTimeout(() => (fileDragOver = false), 700);
    }

    // The map takes files only in edit mode. While playing, a file over the map is the chat's: it is caught on the
    // way down, before the map's own drop listener can show its overlay or take it.
    function isOverPlayingMap(event: DragEvent): boolean {
        return (
            event.target instanceof HTMLCanvasElement &&
            event.target.closest("#game") !== null &&
            !get(mapEditorToolbarInUseStore)
        );
    }

    function onMapFileDragCapture(event: DragEvent) {
        if (!isFileDrag(event) || isEnded || !messageInputBarRef || !isOverPlayingMap(event)) return;
        event.stopPropagation();
        if (event.type === "drop") {
            event.preventDefault();
            onDropFiles(event);
        } else {
            acceptFileDrag(event);
        }
    }

    onMount(() => {
        document.addEventListener("dragenter", onMapFileDragCapture, true);
        document.addEventListener("dragover", onMapFileDragCapture, true);
        document.addEventListener("drop", onMapFileDragCapture, true);
    });

    function onDocumentDragLeave(event: DragEvent) {
        // Leaving the window (relatedTarget can't tell: WebKit leaves it empty on every element).
        if (
            event.clientX <= 0 ||
            event.clientY <= 0 ||
            event.clientX >= window.innerWidth ||
            event.clientY >= window.innerHeight
        ) {
            endFileDrag();
        }
    }

    function onDocumentDrop(event: DragEvent) {
        if (!takesFileDrop(event) || event.defaultPrevented) {
            endFileDrag();
            return;
        }
        event.preventDefault();
        onDropFiles(event);
    }

    onDestroy(() => {
        resizeObserver?.disconnect();
        childListObserver?.disconnect();
        clearTimeout(redrawTimer);
        if (redrawFrame !== undefined) cancelAnimationFrame(redrawFrame);
        clearTimeout(fileDragTimer);
        clearTimeout(replyLimitTimer);
        document.removeEventListener("dragenter", onMapFileDragCapture, true);
        document.removeEventListener("dragover", onMapFileDragCapture, true);
        document.removeEventListener("drop", onMapFileDragCapture, true);
        // However the chat is left (another chat picked, a message opening one), its details close with it: coming
        // back opens on the conversation.
        if (get(openRoomDetailsIdStore) === room.id) openRoomDetailsIdStore.set(undefined);
        if (get(openSharedItemsStore)?.roomId === room.id) openSharedItemsStore.set(undefined);
    });
</script>

<svelte:window on:resize={onWindowResize} />
<svelte:document on:dragover={onDocumentDragOver} on:dragleave={onDocumentDragLeave} on:drop={onDocumentDrop} />

<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
    bind:this={timelineRef}
    class="relative isolate flex flex-col flex-auto h-full w-full max-w-full"
    class:profile-open={(profileOpen && matrixRoom && $directPartner) || roomDetailsOpen || sharedOpen}
    on:dragover|preventDefault
    on:drop|preventDefault|stopPropagation={onDropFiles}
>
    {#if fileDragOver}
        <div class="file-drop-target" data-testid="chatFileDropTarget" aria-hidden="true">
            {matrixRoom
                ? $LL.chat.fileAttachment.dropToAdd({ name: $roomName })
                : $LL.chat.fileAttachment.dropToAddHere()}
        </div>
    {/if}
    <!-- Made again when the chat is, so a panel never shows the old one. -->
    {#key roomInstance}
        {#if sharedOpen && matrixRoom}
            <SharedPanel room={matrixRoom} tab={sharedOpen.tab} partnerChatId={$directPartner?.chatId} />
        {:else if profileOpen && matrixRoom && $directPartner}
            <!-- Over the conversation, which stays as it was (draft, files, scroll) for when you come back. Above the
                 message options (z-50) and menus that live in it; "isolate" keeps all of that inside this panel. -->
            <PartnerProfilePanel
                room={matrixRoom}
                partner={$directPartner}
                on:close={() => openProfileRoomIdStore.set(undefined)}
            />
        {:else if roomDetailsOpen && matrixRoom}
            <RoomDetailsPanel room={matrixRoom} />
        {/if}
    {/key}
    {#if room !== undefined}
        <div class="flex flex-col gap-2">
            <div
                class="relative p-2 flex items-center gap-1 border border-solid border-x-0 border-b border-t-0 border-white/10"
            >
                {#if chatRoomsEnableInAdmin}
                    <button
                        class="back-roomlist p-3 text-white hover:bg-white/10 rounded-2xl aspect-square w-12 shrink-0"
                        data-testid="chatBackward"
                        on:click={goBackAndClearSelectedChatMessage}
                    >
                        {#if direction === "rtl"}
                            <IconChevronRight font-size="20" />
                        {:else}
                            <IconChevronLeft font-size="20" />
                        {/if}
                    </button>
                {/if}
                <!-- Every chat's title starts right after the back arrow, so the picture never moves with the name. -->
                <div class="flex min-w-0 grow items-center">
                    {#if proximityRoom && isEnded}
                        <div class="flex min-w-0 max-w-full flex-col" data-testid="threadNow" data-state="ended">
                            <div class="max-w-full truncate text-md font-bold leading-5" data-testid="roomName">
                                {endedTitle}
                            </div>
                            <div class="max-w-full truncate text-xs text-white/60" data-testid="threadNowLabel">
                                {endedSubtitle}
                            </div>
                        </div>
                    {:else if proximityRoom}
                        <ProximityThreadTitle room={proximityRoom} />
                    {:else if matrixRoom && $directPartner}
                        <DirectChatTitle
                            room={matrixRoom}
                            partner={$directPartner}
                            bot={partnerBotId !== undefined}
                            botState={shownBotState}
                            on:openProfile={() => openProfileRoomIdStore.set(room.id)}
                        />
                    {:else}
                        <!-- A group's name opens its details, as a direct chat's name opens the profile. -->
                        <svelte:element
                            this={matrixRoom ? "button" : "div"}
                            type={matrixRoom ? "button" : undefined}
                            class="room-title flex min-w-0 items-center gap-2.5 px-2"
                            aria-label={matrixRoom ? $LL.chat.details.open({ name: $roomName }) : undefined}
                            data-testid="roomTitleButton"
                            on:click={() => {
                                if (matrixRoom) openRoomDetailsIdStore.set(room.id);
                            }}
                        >
                            <Avatar pictureStore={room.pictureStore} fallbackName={$roomName} size="sm" />
                            <div class="flex min-w-0 flex-col">
                                <div class="flex min-w-0 items-center gap-1.5">
                                    <div class="truncate text-md font-bold leading-5" data-testid="roomName">
                                        {$roomName}
                                    </div>
                                    {#if $isEncrypted}
                                        <span
                                            class="shrink-0 text-white/50"
                                            title={$LL.chat.thread.encrypted()}
                                            data-testid="threadEncryptedLock"
                                        >
                                            <IconLock font-size="14" />
                                            <span class="sr-only">{$LL.chat.thread.encrypted()}</span>
                                        </span>
                                    {/if}
                                </div>
                                {#if memberCount > 0}
                                    <div class="truncate text-xs text-white/60" data-testid="roomMemberCount">
                                        {$LL.chat.directChat.members({ count: memberCount })}
                                    </div>
                                {/if}
                            </div>
                        </svelte:element>
                    {/if}
                </div>
                {#if matrixRoom}
                    <div class="flex h-12 w-12 shrink-0 items-center justify-center">
                        <RoomMenu room={matrixRoom} inHeader />
                    </div>
                    <!-- When the chat carries its own close, it sits at this end of the header: keep its place free so
                         it never covers the menu. -->
                    {#if $chatCarriesItsCloseStore}
                        <div class="h-12 w-12 shrink-0" aria-hidden="true" />
                    {/if}
                {/if}
                {#if shouldDisplayLoader}
                    <!-- Over the empty space at the top of the list, so the messages don't move when it shows. -->
                    <div
                        class="absolute left-0 right-0 top-full z-10 flex justify-center items-center pt-1 pointer-events-none"
                    >
                        <IconLoader class="animate-[spin_2s_linear_infinite]" font-size={25} />
                    </div>
                {/if}
            </div>
            {#if matrixRoom}
                <!-- Made again when the chat is, so it never shows the old one's pins. -->
                {#key roomInstance}
                    <PinnedBar
                        room={matrixRoom}
                        onShowAll={() =>
                            directPartner ? openProfileRoomIdStore.set(room.id) : openRoomDetailsIdStore.set(room.id)}
                    />
                {/key}
            {/if}
            {#if liveElsewhere && proximityRoom}
                <div
                    class="mx-2 flex items-center gap-2 rounded-xl bg-success/15 px-3 py-2 text-xs text-white"
                    data-testid="proximityLiveNotice"
                >
                    <span class="h-2 w-2 shrink-0 rounded-full bg-success" aria-hidden="true" />
                    <span class="grow">{liveNotice}</span>
                    <button
                        type="button"
                        class="m-0 rounded-lg bg-white/10 px-2 py-1 text-xs font-bold hover:bg-white/20"
                        data-testid="proximityLiveNoticeOpen"
                        on:click={() => proximityRoom?.open()}
                    >
                        {$LL.chat.session.goToChat()}
                    </button>
                </div>
            {/if}
        </div>
        <div
            bind:this={messageListRef}
            class="flex overflow-auto grow shrink basis-0 min-h-0 justify-center items-end relative"
            on:scroll={handleScroll}
        >
            {#if showLoading}
                <div
                    class="absolute inset-0 flex items-center justify-center pointer-events-none"
                    data-testid="chatMessagesLoading"
                    role="status"
                >
                    <IconLoader class="animate-[spin_2s_linear_infinite]" font-size={25} />
                </div>
            {/if}
            <ul
                bind:this={messageListContentRef}
                class="list-none p-0 flex-1 flex flex-col max-h-full pt-10 {$messages.length === 0
                    ? 'items-center justify-center pb-4'
                    : 'max-w-6xl'}"
                class:invisible={firstFillPending}
            >
                <!--{#if room.id === "proximity" && $connectedUsers !== undefined}-->
                <!--    <div class="flex flex-row items-center gap-2">-->
                <!--        {#each [...$connectedUsers] as [userId, user] (userId)}-->
                <!--            <div class="avatar">-->
                <!--                <Avatar avatarUrl={user.avatarUrl} fallbackName={user?.username} color={user?.color} />-->
                <!--            </div>-->
                <!--        {/each}-->
                <!--    </div>-->
                <!--{/if}-->
                {#if shownSession && !isEnded && !isRoomMessages}
                    <li class="px-4 pb-2 text-center text-xs text-white/45" data-testid="proximityExplainer">
                        {$LL.chat.session.explainer()}
                    </li>
                {/if}
                {#if isEmptyProximityView && isEnded}
                    <li class="text-center px-3 py-6 text-sm text-white/50">{$LL.chat.session.empty()}</li>
                {:else if shownSession && shownSession.isLive}
                    <!-- In a bubble with nothing written yet: the explainer above is enough. -->
                {:else if $messages.length === 0 || isEmptyProximityView}
                    {#if room instanceof ProximityChatRoom}
                        <li class="text-center px-3 max-w-md">
                            <img draggable="false" src={getCloseImg} alt="Discussion bubble" />
                            <div class="text-lg font-bold text-center">{$LL.chat.getCloserTitle()}</div>
                            <div class="text-sm opacity-50 text-center">
                                {$LL.chat.getCloserDesc()}
                            </div>
                        </li>
                    {:else if !showLoading}
                        <li class="text-center px-3 max-w-md relative">
                            <IconMailBox font-size="40" />
                            <div class="text-lg font-bold text-center">{$LL.chat.noMessage()}</div>
                            <div class="text-sm opacity-50 text-center">{$LL.chat.beFirst()}</div>
                            <div class="absolute w-10 h-10 -bottom-1.5 -left-10">
                                <svg
                                    width="51"
                                    height="45"
                                    viewBox="0 0 51 45"
                                    fill="none"
                                    xmlns="http://www.w3.org/2000/svg"
                                >
                                    <path
                                        d="M7.46934 42.1088C7.31199 42.9222 7.84378 43.7091 8.65713 43.8664C9.47048 44.0238 10.2574 43.492 10.4147 42.6786L7.46934 42.1088ZM48.8329 3.45148C49.6538 3.34051 50.2294 2.58502 50.1184 1.76406C50.0074 0.943102 49.2519 0.367545 48.431 0.47852L48.8329 3.45148ZM3.03603 31.9911C2.60916 31.2811 1.68756 31.0516 0.977578 31.4785C0.267597 31.9053 0.038091 32.8269 0.464962 33.5369L3.03603 31.9911ZM7.22548 41.8701L5.93995 42.643L5.94067 42.6442L7.22548 41.8701ZM10.842 42.9209L10.2291 41.5518L10.2278 41.5524L10.842 42.9209ZM21.7611 39.6758C22.5172 39.3373 22.8557 38.4499 22.5172 37.6938C22.1787 36.9377 21.2913 36.5992 20.5352 36.9377L21.7611 39.6758ZM8.94203 42.3937C10.4147 42.6786 10.4147 42.679 10.4146 42.6792C10.4146 42.6792 10.4146 42.6794 10.4146 42.6794C10.4146 42.6794 10.4146 42.6792 10.4147 42.6786C10.4149 42.6776 10.4153 42.6755 10.416 42.6723C10.4172 42.666 10.4193 42.6556 10.4222 42.641C10.4281 42.612 10.4375 42.5667 10.4504 42.5059C10.4762 42.3842 10.5163 42.2006 10.5721 41.9611C10.6837 41.4819 10.8576 40.7796 11.1039 39.9023C11.5969 38.1466 12.3779 35.6973 13.5261 32.9384C15.8321 27.3978 19.5724 20.7218 25.3326 15.8605L23.3977 13.5678C17.1251 18.8616 13.1538 26.0254 10.7564 31.7857C9.55296 34.6773 8.73434 37.2439 8.21562 39.0914C7.95608 40.0157 7.77112 40.7618 7.6503 41.2807C7.58987 41.5402 7.54545 41.743 7.51573 41.883C7.50087 41.953 7.48968 42.0074 7.48201 42.0452C7.47817 42.0642 7.47521 42.079 7.4731 42.0896C7.47205 42.095 7.47121 42.0992 7.47059 42.1024C7.47027 42.104 7.47001 42.1054 7.46981 42.1064C7.4697 42.107 7.46959 42.1076 7.46953 42.1078C7.46943 42.1084 7.46934 42.1088 8.94203 42.3937ZM25.3326 15.8605C37.1451 5.89135 46.5336 3.76229 48.8329 3.45148L48.431 0.47852C45.5724 0.86493 35.6508 3.2269 23.3977 13.5678L25.3326 15.8605ZM0.464962 33.5369L5.93995 42.643L8.51102 41.0972L3.03603 31.9911L0.464962 33.5369ZM5.94067 42.6442C7.08293 44.54 9.46921 45.1811 11.4562 44.2894L10.2278 41.5524C9.52671 41.8671 8.81489 41.6015 8.51029 41.096L5.94067 42.6442ZM11.4549 44.29L21.7611 39.6758L20.5352 36.9377L10.2291 41.5518L11.4549 44.29Z"
                                        fill="#FAF7F0"
                                    />
                                </svg>
                            </div>
                        </li>
                    {/if}
                {/if}
                {#each timelineEntries as entry, index (entry.message.id)}
                    {@const place = runs.get(entry.message.id)}
                    {@const isNotice = noticeFlags[index]}
                    {@const afterNotice = index > 0 && noticeFlags[index - 1]}
                    <li
                        class="last:pb-3"
                        class:run-start={!isNotice && !afterNotice && (place?.runStart ?? true)}
                        class:run-continued={!isNotice && place !== undefined && !place.runStart}
                        class:notice-after-message={isNotice && index > 0 && !afterNotice}
                        data-event-id={entry.message.id}
                    >
                        {#if place?.dayStart && entry.message.date}
                            <!-- The same look as someone joining or leaving (MessageSystem). -->
                            <div class="flex justify-center mb-3" data-testid="chatDayLabel">
                                <span
                                    class="px-3 py-1.5 m-0 text-xs text-center border border-solid border-white/10 rounded-2xl text-white/80"
                                    >{dayLabel(entry.message.date, $locale)}</span
                                >
                            </div>
                        {/if}
                        {#if (entry.role === "start" || entry.role === "resume") && entry.message.session}
                            <SessionDivider
                                marker={entry.message.session}
                                date={entry.message.date}
                                isCurrent={entry.isCurrentSession}
                                resumed={entry.role === "resume"}
                            />
                        {:else if entry.message.type === "outcoming" || entry.message.type === "incoming"}
                            <MessageSystem message={entry.message} />
                        {:else if entry.message.replyLimit}
                            {#if shownReplyLimits.has(entry.message.id)}
                                <BotReplyLimitCard replyLimit={entry.message.replyLimit} />
                            {/if}
                        {:else if entry.message.botStatus}
                            <BotStatusNoteCard note={entry.message.botStatus} />
                        {:else}
                            <Message
                                on:updateMessageBody={onUpdateMessageBody}
                                message={entry.message}
                                runStart={place?.runStart ?? true}
                            />
                            {#if "stoppedOnLeave" in entry.message && entry.message.stoppedOnLeave}
                                <div class="px-4 pb-2 text-xs italic text-white/45" data-testid="proximityStoppedNote">
                                    {$LL.chat.session.stopped()}
                                </div>
                            {/if}
                        {/if}
                    </li>
                {/each}
                {#if botLeftLine}
                    <li class="last:pb-3" data-testid="botLeftLine"><MessageSystem message={botLeftLine} /></li>
                {/if}
            </ul>
        </div>

        <CopiedPill />

        {#if isEnded && shownSession}
            <!-- An ended proximity chat can't receive anything: a way back to the people replaces the composer. -->
            <ProximityEndedFooter session={shownSession} live={liveSession} onContinue={() => proximityRoom?.open()} />
        {:else}
            <!-- One composer per conversation: its draft, files and pending sends belong to this room only.
                 Keyed by id: re-selecting the same room must not remount it (files, focus and uploads are kept). -->
            {#if botClosed}
                <!-- The bot was deleted: nothing can reach it, so the message box gives way to a plain closed bar. -->
                <div
                    class="mx-2.5 mb-2.5 mt-1.5 flex min-h-12 items-center justify-center rounded-full border border-dashed border-white/12 bg-white/[0.03] px-3.5 text-sm text-white/50"
                    data-testid="botChatClosed"
                >
                    {$LL.chat.botStatus.closed()}
                </div>
            {:else}
                {#key room.id}
                    <MessageInputBar
                        disabled={$shouldRetrySendingEvents}
                        {room}
                        partner={$directPartner}
                        inputHint={botPlaceholder}
                        bind:this={messageInputBarRef}
                    />
                {/key}
            {/if}
        {/if}
    {/if}
</div>

<style>
    /* Runs sit close together; a new run gets room for its label. Notices ("With …", joining, leaving) keep their own spacing. */
    li.run-start {
        padding-top: 8px;
    }

    li.run-continued {
        padding-top: 2px;
    }

    li.notice-after-message {
        padding-top: 8px;
    }

    /* Over the whole conversation while a file is dragged anywhere in the window. */
    .file-drop-target {
        position: absolute;
        inset: 6px;
        z-index: 60;
        display: grid;
        place-items: center;
        padding: 12px;
        border: 2px dashed #c4b5fd;
        border-radius: 16px;
        background: rgb(134 41 252 / 0.22);
        color: #fff;
        font-weight: 700;
        text-align: center;
        pointer-events: none;
    }
    /* The profile has no background of its own: it sits on the chat panel's surface, like the conversation. What it
       covers is hidden instead, and keeps its draft, files and scroll for when you come back. */
    .profile-open
        > :global(
            :not([data-testid="partnerProfilePanel"]):not([data-testid="roomDetailsPanel"]):not(
                    [data-testid="sharedPanel"]
                )
        ) {
        visibility: hidden;
    }
    .room-title {
        margin: 0;
        padding-block: 0.25rem;
        border-radius: 0.75rem;
        color: inherit;
        font: inherit;
        text-align: start;
        background: transparent;
    }
    button.room-title:hover {
        background: rgba(255, 255, 255, 0.08);
    }
    button.room-title:focus-visible {
        outline: 2px solid rgba(196, 181, 253, 0.9);
        outline-offset: -2px;
    }
</style>
