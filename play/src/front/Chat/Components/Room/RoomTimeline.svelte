<script lang="ts">
    import { afterUpdate, beforeUpdate, hasContext, onDestroy, onMount, setContext, tick } from "svelte";
    import { derived, get, readable, writable } from "svelte/store";
    import type { Readable } from "svelte/store";
    import { gameManager } from "../../../Phaser/Game/GameManager";
    import type { ChatMessage, ChatRoom } from "../../Connection/ChatConnection";
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
    import {
        PERSON_COLOUR_CONTEXT,
        WOKA_BY_CHAT_ID_CONTEXT,
        createColourByChatIdStore,
        createWokaByChatIdStore,
        personColour,
    } from "../../Stores/ChatUserWokaStore";
    import type { PersonColourOf } from "../../Stores/ChatUserWokaStore";
    import Avatar from "../Avatar.svelte";
    import { MatrixChatRoom } from "../../Connection/Matrix/MatrixChatRoom";
    import { openProfileRoomIdStore } from "../../Stores/PartnerProfileStore";
    import { chatCarriesItsCloseStore } from "../../ChatSidebarWidthStore";
    import { installStrayFileDropGuard, isFileDrag } from "../../../Utils/strayFileDropGuard";
    import { mapEditorToolbarInUseStore } from "../../../Stores/MapEditorStore";
    import Message from "./Message.svelte";
    import MessageInputBar from "./MessageInputBar.svelte";
    import MessageSystem from "./MessageSystem.svelte";
    import TypingUsers from "./TypingUsers.svelte";
    import SessionDivider from "./Thread/SessionDivider.svelte";
    import ProximityThreadTitle from "./Thread/ProximityThreadTitle.svelte";
    import ProximityEndedFooter from "./Thread/ProximityEndedFooter.svelte";
    import RoomMenu from "./RoomMenu/RoomMenu.svelte";
    import DirectChatTitle from "./DirectChat/DirectChatTitle.svelte";
    import PartnerProfilePanel from "./DirectChat/PartnerProfilePanel.svelte";
    import { directPartnerStore } from "./DirectChat/DirectPartnerStore";
    import { IconChevronLeft, IconChevronRight, IconLoader, IconLock, IconMailBox } from "@wa-icons";

    export let room: ChatRoom;

    // Messages show the sender's woka when their chat account has no picture (Matrix users).
    if (!hasContext(WOKA_BY_CHAT_ID_CONTEXT)) {
        setContext(
            WOKA_BY_CHAT_ID_CONTEXT,
            createWokaByChatIdStore(gameManager.getCurrentGameScene().userProviderMerger)
        );
    }

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
    let autoScroll = true;
    let onScrollTop = false;

    let oldScrollHeight = 0;

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
    $: typingMembers = room.typingMembers;
    $: isEncrypted = room.isEncrypted;
    $: proximityRoom = room instanceof ProximityChatRoom ? room : undefined;
    $: matrixRoom = room instanceof MatrixChatRoom ? room : undefined;
    // A direct chat knows who the other person is and where they are right now (header, menu, profile).
    $: directPartner = matrixRoom?.type === "direct" ? directPartnerStore(matrixRoom) : undefined;
    $: profileOpen = directPartner !== undefined && $openProfileRoomIdStore === room.id;
    $: isDirectChat.set(directPartner !== undefined);
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

    onMount(() => {
        installStrayFileDropGuard();
        initMessages()
            .catch((error) => console.error(error))
            .finally(() => {
                // The first time, jump to the bottom while the list is still hidden, then show it.
                scrollToMessageListBottom(proximityRoom !== undefined);
                initialLoadDone = true;
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
            scrollToMessageListBottom(proximityRoom !== undefined);
            setFirstListItem();
        } catch (error) {
            console.error(`Failed to load messages: ${error}`);
        }
    }

    beforeUpdate(() => {
        if (messageListRef) {
            oldScrollHeight = messageListRef.scrollHeight;
            const scrollableDistance = messageListRef.scrollHeight - messageListRef.offsetHeight;
            autoScroll = messageListRef.scrollTop > scrollableDistance - 20;
            onScrollTop = messageListRef.scrollTop === 0;
        }
    });

    afterUpdate(() => {
        room.setTimelineAsRead();
        // While the list is hidden for its first fill, it is scrolled once, when it is done.
        if (firstFillPending) return;
        if (autoScroll) {
            scrollToMessageListBottom();
        } else if (onScrollTop) {
            const oldFirstListItem = messageListRef.querySelector<HTMLLIElement>('li[data-first-li="true"]');

            if (oldFirstListItem !== null) {
                const newScrollHeight = messageListRef.scrollHeight;
                messageListRef.scrollTop = newScrollHeight - oldScrollHeight;
            }
            setFirstListItem();
        }
    });

    function scrollToMessageListBottom(smooth = true) {
        // Safety check for undefined reference
        // After disposing the component, the reference can be undefined
        if (messageListRef == undefined) return;
        messageListRef.scroll({ top: messageListRef.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    }

    function goBackAndClearSelectedChatMessage() {
        openProfileRoomIdStore.set(undefined);
        selectedChatMessageToReply.set(null);
        selectedRoomStore.set(undefined);
        shouldRestoreChatStateStore.set(false);
    }

    function handleScroll() {
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
        const messagesBeforeViewportTop = messages.find((msg) => msg.getBoundingClientRect().top >= 0);

        return (
            messagesBeforeViewportTop &&
            messages.indexOf(messagesBeforeViewportTop) < 10 &&
            messages.indexOf(messagesBeforeViewportTop) !== -1 &&
            get(room.hasPreviousMessage)
        );
    }

    function setFirstListItem() {
        const oldFirstListItem = messageListRef.querySelector<HTMLLIElement>('li[data-first-li="true"]');
        oldFirstListItem?.removeAttribute("data-first-li");

        const firstListItem = messageListRef.getElementsByTagName("li").item(0);
        firstListItem?.setAttribute("data-first-li", "true");
    }

    function isViewportNotFilled() {
        return messageListRef.scrollHeight <= messageListRef.clientHeight;
    }

    function onUpdateMessageBody(event: CustomEvent) {
        if (firstFillPending) return;
        if (
            autoScroll ||
            (event.detail != undefined &&
                $messages.length > 0 &&
                event.detail.id === $messages[$messages.length - 1].id &&
                $messages[$messages.length - 1].sender?.chatId === myChatID)
        ) {
            scrollToMessageListBottom();
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
        clearTimeout(fileDragTimer);
        document.removeEventListener("dragenter", onMapFileDragCapture, true);
        document.removeEventListener("dragover", onMapFileDragCapture, true);
        document.removeEventListener("drop", onMapFileDragCapture, true);
    });
</script>

<svelte:document on:dragover={onDocumentDragOver} on:dragleave={onDocumentDragLeave} on:drop={onDocumentDrop} />

<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
    bind:this={timelineRef}
    class="relative isolate flex flex-col flex-auto h-full w-full max-w-full"
    class:profile-open={profileOpen && matrixRoom && $directPartner}
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
    {#if profileOpen && matrixRoom && $directPartner}
        <!-- Over the conversation, which stays as it was (draft, files, scroll) for when you come back. Above the
             message options (z-50) and menus that live in it; "isolate" keeps all of that inside this panel. -->
        <PartnerProfilePanel
            room={matrixRoom}
            partner={$directPartner}
            on:close={() => openProfileRoomIdStore.set(undefined)}
        />
    {/if}
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
                            on:openProfile={() => openProfileRoomIdStore.set(room.id)}
                        />
                    {:else}
                        <div class="flex min-w-0 items-center gap-2.5 px-2">
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
                        </div>
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
            </div>
            {#if shouldDisplayLoader}
                <div class="flex justify-center items-center w-full pb-1 bg-transparent">
                    <IconLoader class="animate-[spin_2s_linear_infinite]" font-size={25} />
                </div>
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
            class="flex overflow-auto h-full justify-center items-end relative"
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
                {#each timelineEntries as entry (entry.message.id)}
                    <li class="last:pb-3" data-event-id={entry.message.id}>
                        {#if (entry.role === "start" || entry.role === "resume") && entry.message.session}
                            <SessionDivider
                                marker={entry.message.session}
                                date={entry.message.date}
                                isCurrent={entry.isCurrentSession}
                                resumed={entry.role === "resume"}
                            />
                        {:else if entry.message.type === "outcoming" || entry.message.type === "incoming"}
                            <MessageSystem message={entry.message} />
                        {:else}
                            <Message on:updateMessageBody={onUpdateMessageBody} message={entry.message} />
                            {#if "stoppedOnLeave" in entry.message && entry.message.stoppedOnLeave}
                                <div class="px-4 pb-2 text-xs italic text-white/45" data-testid="proximityStoppedNote">
                                    {$LL.chat.session.stopped()}
                                </div>
                            {/if}
                        {/if}
                    </li>
                {/each}
            </ul>
        </div>

        {#if $typingMembers.length > 0 && !isEnded}
            <TypingUsers typingMembers={$typingMembers} />
        {/if}

        {#if isEnded && shownSession}
            <!-- An ended proximity chat can't receive anything: a way back to the people replaces the composer. -->
            <ProximityEndedFooter session={shownSession} live={liveSession} onContinue={() => proximityRoom?.open()} />
        {:else}
            <!-- One composer per conversation: its draft, files and pending sends belong to this room only.
                 Keyed by id: re-selecting the same room must not remount it (files, focus and uploads are kept). -->
            {#key room.id}
                <MessageInputBar disabled={$shouldRetrySendingEvents} {room} bind:this={messageInputBarRef} />
            {/key}
        {/if}
    {/if}
</div>

<style>
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
    .profile-open > :global(:not([data-testid="partnerProfilePanel"])) {
        visibility: hidden;
    }
</style>
