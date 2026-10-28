<script lang="ts">
    import type { ComponentType } from "svelte";
    import { createEventDispatcher, getContext, hasContext, setContext } from "svelte";
    import { derived, readable } from "svelte/store";
    import type { Readable } from "svelte/store";
    import type { PictureStore } from "../../../Stores/PictureStore";
    import { PERSON_COLOUR_CONTEXT, WOKA_BY_CHAT_ID_CONTEXT, personPicture } from "../../Stores/ChatUserWokaStore";
    import type { PersonColourOf } from "../../Stores/ChatUserWokaStore";
    import type { ChatMessage, ChatMessageType } from "../../Connection/ChatConnection";
    import LL, { locale } from "../../../../i18n/i18n-svelte";
    import TopRowAvatar from "../TopRow/TopRowAvatar.svelte";
    import { selectedChatMessageToEdit } from "../../Stores/ChatStore";
    import { ProximityChatMessage } from "../../Connection/Proximity/ProximityChatRoom";
    import LinkPreview from "../../LinkPreview/LinkPreview.svelte";
    import BotRoomCard from "../../Bots/BotRoomCard.svelte";
    import ArtifactCardView from "../../../Artifacts/ArtifactCardView.svelte";
    import { readArtifactLine } from "../../../Artifacts/artifactCard";
    import { bodyShownWithCard } from "../../LinkPreview/ChatLinkKind";
    import MessageOptions from "./MessageOptions.svelte";
    import MessageImage from "./Message/MessageImage.svelte";
    import MessageText from "./Message/MessageText.svelte";
    import MessageFile from "./Message/MessageFile.svelte";
    import MessageAudioFile from "./Message/MessageAudioFile.svelte";
    import MessageVideoFile from "./Message/MessageVideoFile.svelte";
    import MessageGallery from "./Message/MessageGallery.svelte";
    import { MESSAGE_SENDER_CONTEXT, type MessageSenderInfo } from "./Message/messageSenderContext";
    import MessageEdition from "./MessageEdition.svelte";
    import MessageReactions from "./MessageReactions.svelte";
    import MessageIncoming from "./Message/MessageIncoming.svelte";
    import MessageOutcoming from "./Message/MessageOutcoming.svelte";
    import MessageActionMenu from "./MessageActions/MessageActionMenu.svelte";
    import QuotedMessage from "./MessageActions/QuotedMessage.svelte";
    import { messageGestures } from "./MessageActions/messageGestures";
    import { availableActions, hasAnyAction, replyTo } from "./MessageActions/availableActions";
    import { flashMessage } from "./Details/Pins";
    import { chatTime } from "./MessageTime";
    import { IconArrowBackUp, IconInfoCircle, IconPaperclip, IconTrash } from "@wa-icons";

    export let message: ChatMessage;
    export let replyDepth = 0;
    /** First message of its run (see MessageRuns): it shows the name, the time and the face. */
    export let runStart = true;

    let messageRef: HTMLDivElement | undefined;
    let bubbleRef: HTMLDivElement | undefined;
    let menuOpen = false;
    let barOpen = false;
    let barRef: HTMLDivElement | undefined;
    /** "side": next to the bubble, in the empty space toward the middle of the chat. "above": over its inner top corner. */
    let barPlacement: "side" | "above" = "side";

    function placeBar() {
        if (!barRef || !bubbleRef || !messageRef) return;
        const row = messageRef.getBoundingClientRect();
        const bubble = bubbleRef.getBoundingClientRect();
        const room = isMyMessage ? bubble.left - row.left : row.right - bubble.right;
        barPlacement = room >= barRef.offsetWidth + 12 ? "side" : "above";
    }
    let swipeProgress = 0;

    // Senders show their woka, picked the same way as in the chat list.
    const wokaByChatId: Readable<Map<string, PictureStore>> = hasContext(WOKA_BY_CHAT_ID_CONTEXT)
        ? getContext(WOKA_BY_CHAT_ID_CONTEXT)
        : readable(new Map<string, PictureStore>());
    // In a direct chat, on their colour from People.
    const colourOf: Readable<PersonColourOf> = hasContext(PERSON_COLOUR_CONTEXT)
        ? getContext(PERSON_COLOUR_CONTEXT)
        : readable(() => undefined);

    const dispatch = createEventDispatcher<{
        updateMessageBody: { id: string };
    }>();

    const {
        id,
        sender,
        isMyMessage,
        date,
        content,
        quotedMessage,
        isQuotedMessage,
        type,
        isDeleted,
        isModified,
        reactions,
    } = message;

    // File cards say who sent the file.
    setContext<MessageSenderInfo>(MESSAGE_SENDER_CONTEXT, {
        name: sender?.username,
        isMine: isMyMessage,
        messageId: id,
        sentAt: date ?? undefined,
    });

    $: senderPicture = personPicture($wokaByChatId, sender?.chatId, sender?.pictureStore) ?? readable(undefined);
    $: senderColour = $colourOf(sender?.chatId, sender?.username);
    // The label over a run: the name for others, the time for everyone. The full date shows on hover.
    $: showLabel = runStart && replyDepth === 0 && !isQuotedMessage && !messageFromSystem;
    $: shownTime = date ? chatTime(date, $locale) : "";
    $: fullDate =
        date?.toLocaleString($locale, {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
        }) ?? "";

    const updateMessageBody = () => {
        dispatch("updateMessageBody", {
            id: message.id,
        });
    };

    const messageFromSystem = type === "incoming" || type === "outcoming";
    // A proximity message whose conversation ended before its upload finished: shown here, never sent.
    const notSent = message instanceof ProximityChatMessage && message.notSent === true;

    const messageType: { [key in ChatMessageType]: ComponentType } = {
        image: MessageImage as ComponentType,
        text: MessageText as ComponentType,
        file: MessageFile as ComponentType,
        audio: MessageAudioFile as ComponentType,
        video: MessageVideoFile as ComponentType,
        gallery: MessageGallery as ComponentType,
        incoming: MessageIncoming as ComponentType,
        outcoming: MessageOutcoming as ComponentType,
        proximity: MessageText as ComponentType,
    };

    const actions = availableActions(message);
    $: actionable =
        replyDepth === 0 &&
        !isQuotedMessage &&
        !$isDeleted &&
        !messageFromSystem &&
        ($selectedChatMessageToEdit === null || $selectedChatMessageToEdit.id !== id) &&
        hasAnyAction($actions);
    $: if (!actionable) menuOpen = false;

    function openMenu() {
        if (!actionable || !bubbleRef) return;
        menuOpen = true;
    }

    /** Tapping a quote scrolls to the message it quotes, if it is loaded, and flashes it. */
    function jumpToQuoted() {
        if (!quotedMessage) return;
        const target = document.querySelector(`[data-event-id="${CSS.escape(quotedMessage.id)}"]`);
        if (target instanceof HTMLElement) flashMessage(target);
    }

    // An encrypted Matrix message only learns whether it is an image, a file… once decrypted, which updates its content.
    $: contentType = $content ? message.type : type;

    // A text message with a link gets a card under it.
    // A bot's artifact is a card, not text: from the field of its direct message, or from the line it put in nearby chat.
    $: artifactCard = $isDeleted
        ? undefined
        : message.artifact ?? readArtifactLine($content?.body, sender?.isBot === true);
    $: hasLinkCard = replyDepth === 0 && !isQuotedMessage && (contentType === "text" || contentType === "proximity");
    // A video or app link that ends the message is shown by its card, not as a long address. Only what is shown
    // changes: the message keeps its link for copying, replies and bots.
    // Some messages (images, files, deleted ones, some bots') come without a text body: they are shown as they are.
    const shownContent = derived(content, (value) =>
        value && typeof value.body === "string" ? { ...value, body: bodyShownWithCard(value.body) } : value
    );
    $: shownBody = typeof $shownContent?.body === "string" ? $shownContent.body.trim() : "";

    const reactionsWithUsers = derived(
        [reactions, ...Array.from(reactions.values()).map((reaction) => reaction.users)],
        ([$reactions, ...$users]) => {
            return Array.from($reactions.values()).filter((reaction) => reaction.users.size > 0);
        }
    );
</script>

<!-- Hovering only decides where the hover bar goes; the bar's buttons are reachable with the keyboard. -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
    id="message"
    tabindex="-1"
    class={`${isMyMessage && "self-end flex-row-reverse relative"} ${
        messageFromSystem && "justify-center"
    } select-text block-user-action messageContainer items-center`}
    class:menu-open={menuOpen}
    class:bar-open={barOpen}
    class:top-level={replyDepth === 0}
    bind:this={messageRef}
    on:mouseenter={placeBar}
    on:focusin={placeBar}
>
    <div
        use:messageGestures={{
            onOpenMenu: openMenu,
            onSwipeReply: actionable && $actions.reply ? () => replyTo(message) : undefined,
            onSwipeProgress: (progress) => (swipeProgress = progress),
            disabled: !actionable,
        }}
        style={replyDepth === 0 ? "max-width: calc( 100% - 50px );" : "padding-left: 0"}
        class="message-grid container-grid justify-start overflow-visible relative {replyDepth === 0
            ? 'max-w-[calc(100% - 100px)]'
            : ''} {isMyMessage ? 'justify-end grid-container-inverted pr-4' : 'justify-start pl-3'}"
    >
        {#if showLabel}
            <div class="messageHeader" class:mine={isMyMessage} data-testid="messageLabel">
                {#if !isMyMessage}
                    <span class="messageHeader-name">{sender?.username ?? ""}</span>
                {/if}
                <time class="messageHeader-time" datetime={date?.toISOString()} title={fullDate}>{shownTime}</time>
            </div>
        {/if}

        {#if (!isMyMessage || isQuotedMessage) && sender !== undefined && replyDepth === 0}
            <!-- Not "avatar": that design-system class paints a grey 40px square behind the round woka. -->
            <!-- Once per run: later messages keep its width so they line up. -->
            <div class="sender-avatar" class:run-continued={!runStart}>
                <TopRowAvatar
                    pictureStore={senderPicture}
                    name={sender?.username ?? ""}
                    color={senderColour}
                    size="xs"
                    ring={false}
                />
            </div>
        {/if}

        {#if actionable && $actions.reply}
            <span
                class="swipe-reply"
                style="opacity: {swipeProgress}; transform: translateY(-50%) scale({0.6 + swipeProgress * 0.4});"
                aria-hidden="true"
            >
                <IconArrowBackUp font-size={14} />
            </span>
        {/if}

        <div
            bind:this={bubbleRef}
            class:lifted={menuOpen}
            class="message rounded-md
                    {$isDeleted && !isMyMessage && !messageFromSystem && replyDepth === 0 ? 'bg-white/10' : ''}
                    {$isDeleted && isMyMessage && !messageFromSystem && replyDepth === 0 ? 'bg-white/10' : ''}
                    {!isMyMessage && !messageFromSystem && !$isDeleted && replyDepth === 0 ? 'bg-contrast' : ''}
                    {isMyMessage && !messageFromSystem && !$isDeleted && replyDepth === 0 && !notSent
                ? 'bg-secondary'
                : ''}
                    {notSent ? 'message-not-sent bg-white/5 border border-dashed border-white/20' : ''}
                    {$reactionsWithUsers.length > 0 && !$isDeleted && replyDepth === 0 ? 'mb-4 p-0.5' : ''}
                    {!isQuotedMessage ? 'my' : ''}"
        >
            {#if $isDeleted}
                <p class="py-2 px-2 m-0 text-xs flex items-center italic gap-2 opacity-50">
                    <IconTrash font-size={12} />
                    {$LL.chat.messageDeleted()}
                </p>
            {:else if $selectedChatMessageToEdit !== null && $selectedChatMessageToEdit.id === id}
                <MessageEdition message={$selectedChatMessageToEdit} />
            {:else}
                {#if replyDepth > 0}
                    <div class="px-2 pt-1 text-xxs font-bold">{isMyMessage ? "You" : sender?.username}</div>
                {/if}
                {#if quotedMessage && replyDepth === 0}
                    <QuotedMessage message={quotedMessage} onJump={jumpToQuoted} />
                {/if}

                {#if !notSent}
                    {#if artifactCard}
                        <ArtifactCardView card={artifactCard} makerName={sender?.username} />
                    {:else if !hasLinkCard}
                        <svelte:component
                            this={messageType[contentType]}
                            on:updateMessageBody={updateMessageBody}
                            {content}
                        />
                    {:else}
                        {#if shownBody !== ""}
                            <svelte:component
                                this={messageType[contentType]}
                                on:updateMessageBody={updateMessageBody}
                                content={shownContent}
                            />
                        {/if}
                        <LinkPreview body={$content?.body} mine={isMyMessage} alone={shownBody === ""} />
                    {/if}
                    {#if message.roomLink && !$isDeleted}
                        <BotRoomCard link={message.roomLink} botName={sender?.username} />
                    {/if}
                {:else if $content.body.trim() !== ""}
                    <div class="opacity-70">
                        <svelte:component this={messageType[contentType]} {content} />
                    </div>
                {/if}
                {#if notSent}
                    {#if $content.fileNames && $content.fileNames.length > 0}
                        <ul class="m-0 flex list-none flex-col gap-1 px-2 pt-1.5 opacity-70">
                            {#each $content.fileNames as fileName, index (index)}
                                <li class="flex min-w-0 items-center gap-1 text-xs">
                                    <IconPaperclip font-size="12" class="shrink-0" />
                                    <span class="truncate">{fileName}</span>
                                </li>
                            {/each}
                        </ul>
                    {/if}
                    <p
                        class="m-0 flex items-center gap-1.5 px-2 pb-1.5 pt-1 text-xs text-white/70"
                        data-testid="messageNotSent"
                    >
                        <IconInfoCircle font-size="14" class="shrink-0" />
                        {$LL.chat.thread.notSent()}
                    </p>
                {/if}

                {#if $reactionsWithUsers.length > 0}
                    <MessageReactions classes={isMyMessage ? "right-2" : "left-2"} reactions={$reactionsWithUsers} />
                {/if}
                {#if $isModified}
                    <div class="text-white/50 text-xxs p-0 m-0 px-2 pb-1 text-right">
                        ({$LL.chat.messageEdited()})
                    </div>
                {/if}
            {/if}
        </div>
        {#if actionable && !menuOpen}
            <div
                bind:this={barRef}
                class="options {barPlacement}"
                class:mine={isMyMessage}
                data-testid="messageHoverBar"
            >
                <MessageOptions {message} {messageRef} bind:open={barOpen} />
            </div>
        {/if}
    </div>
    {#if menuOpen && bubbleRef}
        <MessageActionMenu {message} anchor={bubbleRef} onClose={() => (menuOpen = false)} />
    {/if}
</div>

<style>
    #message {
        display: flex;
        align-items: flex-start;
        position: relative;
    }

    /* Wide enough for the swipe and the menus, without ever making the timeline scroll sideways. */
    #message.top-level {
        overflow-x: clip;
    }

    #message.menu-open {
        z-index: 60;
    }

    /*
     * The hover bar goes beside the bubble, toward the middle of the chat, so it covers nothing. When the bubble is too
     * wide for that, it sits just above the bubble's inner end instead.
     */
    .options {
        position: absolute;
        grid-area: message;
        z-index: 50;
        opacity: 0;
        pointer-events: none;
        transition: opacity 120ms ease;
    }

    .options.side {
        top: -2px;
        left: calc(100% + 6px);
    }

    .options.side.mine {
        left: auto;
        right: calc(100% + 6px);
    }

    .options.above {
        top: -28px;
        right: 0;
    }

    .options.above.mine {
        right: auto;
        left: 0;
    }

    @media (hover: hover) {
        #message.top-level:hover .options,
        #message.top-level:has(:focus-visible) .options,
        #message.bar-open .options {
            opacity: 1;
            pointer-events: auto;
        }
    }

    /* Phones use press and hold instead. */
    @media (hover: none) {
        .options {
            display: none;
        }

        /* Holding a message opens our menu, not the phone's text selection or image menu ("Copy text" covers it). */
        #message.top-level > .message-grid,
        #message.top-level > .message-grid :global(*) {
            -webkit-user-select: none;
            user-select: none;
            -webkit-touch-callout: none;
        }

        /* Except the field you edit a message in: you type, select and move the cursor there. */
        #message.top-level > .message-grid :global([contenteditable="true"]),
        #message.top-level > .message-grid :global([contenteditable="true"] *) {
            -webkit-user-select: text;
            user-select: text;
            -webkit-touch-callout: default;
        }
    }

    .swipe-reply {
        position: absolute;
        left: -30px;
        top: 50%;
        width: 24px;
        height: 24px;
        border-radius: 9999px;
        display: grid;
        place-items: center;
        background: rgb(255 255 255 / 0.14);
        color: #fff;
        pointer-events: none;
    }

    .message.lifted {
        transform: scale(1.02);
        box-shadow: 0 14px 30px rgb(0 0 0 / 0.55);
    }

    :global(li.quote-flash) {
        animation: quote-flash 1.6s ease-out;
    }

    @keyframes -global-quote-flash {
        0%,
        30% {
            background-color: rgb(167 139 250 / 0.22);
        }
        100% {
            background-color: transparent;
        }
    }

    .container-grid {
        overflow: visible;
        display: grid;
        grid-gap: 0;
        grid-template-areas: "avatar label" "avatar message" ". response";
    }

    /*
     * Their label (name and time) also spans a spare column, so a long name never widens the bubble's column: a short
     * message keeps a short bubble, and the hover bar, placed on that column, stays beside it. Mine shows the time only.
     */
    .container-grid:not(.grid-container-inverted) {
        grid-template-columns: auto auto 1fr;
        grid-template-areas: "avatar label label" "avatar message ." ". response .";
    }

    /* Outside the bubble. The name is a little smaller than the text but heavier, so it reads as a label. */
    .messageHeader {
        grid-area: label;
        display: flex;
        align-items: baseline;
        gap: 6px;
        min-width: 0;
        padding: 0 2px 3px;
        line-height: 18px;
        white-space: nowrap;
    }

    .messageHeader.mine {
        justify-content: flex-end;
    }

    .messageHeader-name {
        font-size: 13px;
        font-weight: 600;
        color: rgb(255 255 255 / 0.9);
        overflow: hidden;
        text-overflow: ellipsis;
        min-width: 0;
    }

    /* A long name gives way: the time always shows. */
    .messageHeader-time {
        font-size: 11px;
        color: rgb(255 255 255 / 0.5);
        flex-shrink: 0;
    }

    .message {
        grid-area: message;
        min-width: 180px;
        overflow-wrap: anywhere;
        position: relative;
        transition: transform 160ms ease, box-shadow 160ms ease;
    }

    .sender-avatar {
        grid-area: avatar;
        display: flex;
        align-self: start;
    }

    /* Not overflow: hidden, which would let the column shrink below the face's width in a narrow chat. */
    .sender-avatar.run-continued {
        visibility: hidden;
        height: 0;
    }
</style>
