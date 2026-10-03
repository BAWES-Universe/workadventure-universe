<script lang="ts">
    import type { ComponentType } from "svelte";
    import { createEventDispatcher } from "svelte";
    import { derived } from "svelte/store";
    import type { ChatMessage, ChatMessageType } from "../../Connection/ChatConnection";
    import LL, { locale } from "../../../../i18n/i18n-svelte";
    import Avatar from "../Avatar.svelte";
    import { selectedChatMessageToEdit } from "../../Stores/ChatStore";
    import { ProximityChatMessage } from "../../Connection/Proximity/ProximityChatRoom";
    import MessageOptions from "./MessageOptions.svelte";
    import MessageImage from "./Message/MessageImage.svelte";
    import MessageText from "./Message/MessageText.svelte";
    import MessageFile from "./Message/MessageFile.svelte";
    import MessageAudioFile from "./Message/MessageAudioFile.svelte";
    import MessageVideoFile from "./Message/MessageVideoFile.svelte";
    import MessageGallery from "./Message/MessageGallery.svelte";
    import MessageEdition from "./MessageEdition.svelte";
    import MessageReactions from "./MessageReactions.svelte";
    import MessageIncoming from "./Message/MessageIncoming.svelte";
    import MessageOutcoming from "./Message/MessageOutcoming.svelte";
    import MessageActionMenu from "./MessageActions/MessageActionMenu.svelte";
    import QuotedMessage from "./MessageActions/QuotedMessage.svelte";
    import { messageGestures } from "./MessageActions/messageGestures";
    import { availableActions, hasAnyAction, replyTo } from "./MessageActions/availableActions";
    import { IconArrowBackUp, IconInfoCircle, IconPaperclip, IconTrash } from "@wa-icons";

    export let message: ChatMessage;
    export let replyDepth = 0;

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
        if (!(target instanceof HTMLElement)) return;
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.classList.remove("quote-flash");
        void target.offsetWidth;
        target.classList.add("quote-flash");
        setTimeout(() => target.classList.remove("quote-flash"), 1600);
    }

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
            : ''} {!$isDeleted ? 'group-hover/message:pb-4' : ''} {isMyMessage
            ? 'justify-end grid-container-inverted pr-4'
            : 'justify-start pl-3'}"
    >
        {#if (!isMyMessage || isQuotedMessage) && sender !== undefined && replyDepth === 0}
            <div class="avatar pt-1.5">
                <Avatar pictureStore={sender?.pictureStore} fallbackName={sender?.username} />
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
                    <svelte:component this={messageType[type]} on:updateMessageBody={updateMessageBody} {content} />
                {:else if $content.body.trim() !== ""}
                    <div class="opacity-70">
                        <svelte:component this={messageType[type]} {content} />
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
        {#if replyDepth <= 0}
            <div
                class="messageHeader w-full absolute bottom-0 h-fit group-hover/message:translate-y-[2px] opacity-0 group-hover/message:opacity-100 left-0 text-gray-500 text-xxs px-2 flex justify-between items-end gap-2 overflow-x-hidden"
                class:flex-row-reverse={isMyMessage}
                hidden={isQuotedMessage || messageFromSystem}
            >
                <span
                    hidden={messageFromSystem}
                    class="text-white text-nowrap {!isMyMessage ? 'text-white font-bold' : ''}"
                    >{isMyMessage ? "You" : sender?.username}</span
                >
                <span class={`text-xxs text-nowrap ${isMyMessage ? "mr-1" : "ml-1"}`}
                    >{date?.toLocaleTimeString($locale, {
                        hour: "2-digit",
                        minute: "2-digit",
                    })}</span
                >
                <span class={`text-xxs text-nowrap ${isMyMessage ? "mr-1" : "ml-1"}`}
                    >{date?.toLocaleDateString($locale, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                    })}</span
                >
            </div>
        {/if}
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

    #message.menu-open .messageHeader {
        visibility: hidden;
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
        top: -40px;
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
        grid-gap: 4px;
        grid-template-areas: "avatar message" ". response" ". messageHeader";
    }

    .messageHeader {
        grid-area: messageHeader;
        transition: all 0.2s ease-in-out 0s;
    }

    .message {
        grid-area: message;
        min-width: 180px;
        overflow-wrap: anywhere;
        position: relative;
        transition: transform 160ms ease, box-shadow 160ms ease;
    }

    .message.my:hover + .messageHeader {
        opacity: 1;
    }

    .avatar {
        grid-area: avatar;
        display: flex;
        /*align-items: flex-end;*/
    }
</style>
