<script lang="ts">
    import { onDestroy, onMount, tick } from "svelte";
    import { fade, scale } from "svelte/transition";
    import type { ChatMessage } from "../../../Connection/ChatConnection";
    import LL from "../../../../../i18n/i18n-svelte";
    import { QUICK_REACTIONS, areAllPhotos } from "./messageActions";
    import {
        availableActions,
        copyText,
        deleteMessage,
        editMessage,
        openReactionPicker,
        reactTo,
        replyTo,
        saveMessageFiles,
    } from "./availableActions";
    import { prepareFiles } from "./saveFiles";
    import { IconArrowBackUp, IconCopy, IconDownload, IconMoodPlus, IconPencil, IconTrash } from "@wa-icons";

    /**
     * The press-and-hold (and right-click) menu of a chat message: the message stays in place above a dimmed chat,
     * with a row of reactions on one side and the labelled actions on the other, like WhatsApp and iMessage.
     * It is drawn inside the message so it scrolls with it; the message is raised above the dim while it is open.
     */
    export let message: ChatMessage;
    /** The message bubble the menu is anchored to. */
    export let anchor: HTMLElement;
    export let onClose: () => void;

    const actions = availableActions(message);
    const REACTION_BAR_HEIGHT = 46;
    const GAP = 8;

    let root: HTMLDivElement;
    let menuEl: HTMLDivElement | undefined;
    let reactionTop = 0;
    let menuTop = 0;
    let alignRight = message.isMyMessage;
    let side = 0;
    let positioned = false;

    $: files = $actions.files;
    // Again whenever the files change while the menu is open, so a photo added meanwhile is ready to save too.
    $: prepareFiles(files);
    $: saveLabel = areAllPhotos(files)
        ? files.length > 1
            ? $LL.chat.messageActions.savePhotos({ count: files.length })
            : $LL.chat.messageActions.savePhoto()
        : files.length > 1
        ? $LL.chat.messageActions.saveFiles({ count: files.length })
        : $LL.chat.messageActions.saveFile();

    function scrollParentOf(element: HTMLElement): HTMLElement | undefined {
        let current = element.parentElement;
        while (current) {
            const overflowY = getComputedStyle(current).overflowY;
            if ((overflowY === "auto" || overflowY === "scroll") && current.scrollHeight > current.clientHeight) {
                return current;
            }
            current = current.parentElement;
        }
        return undefined;
    }

    /** The bubble with its reaction chips, which hang below it. */
    function bubbleBox(): { top: number; bottom: number; left: number; right: number } {
        const bubble = anchor.getBoundingClientRect();
        const chips = anchor.querySelector(".reactions-bar")?.getBoundingClientRect();
        return {
            top: bubble.top,
            bottom: chips ? Math.max(bubble.bottom, chips.bottom) : bubble.bottom,
            left: bubble.left,
            right: bubble.right,
        };
    }

    async function position() {
        await tick();
        const container = scrollParentOf(anchor);
        const menuHeight = menuEl?.offsetHeight ?? 0;
        const reactionsSpace = $actions.react ? REACTION_BAR_HEIGHT + GAP : 0;
        const menuSpace = menuHeight > 0 ? menuHeight + GAP : 0;
        const visible = () =>
            container
                ? container.getBoundingClientRect()
                : { top: 0, bottom: window.innerHeight, height: window.innerHeight };

        // Bring the whole menu into view first, as far as the timeline can scroll.
        if (container) {
            const box = visible();
            const bubble = bubbleBox();
            const blockTop = bubble.top - reactionsSpace;
            const blockBottom = bubble.bottom + menuSpace;
            if (blockBottom - blockTop <= box.height - 2 * GAP) {
                if (blockTop < box.top + GAP) container.scrollTop -= box.top + GAP - blockTop;
                else if (blockBottom > box.bottom - GAP) container.scrollTop += blockBottom - (box.bottom - GAP);
            } else {
                container.scrollTop += blockTop - (box.top + GAP);
            }
        }

        const box = visible();
        const rootBox = root.getBoundingClientRect();
        const bubble = bubbleBox();
        const spaceAbove = bubble.top - box.top - GAP;
        const spaceBelow = box.bottom - bubble.bottom - GAP;
        const bubbleTop = bubble.top - rootBox.top;
        const bubbleBottom = bubble.bottom - rootBox.top;

        if (spaceAbove >= reactionsSpace && spaceBelow >= menuSpace) {
            // Reactions above the message, actions below it.
            reactionTop = bubbleTop - reactionsSpace;
            menuTop = bubbleBottom + GAP;
        } else if (spaceAbove >= reactionsSpace + menuSpace) {
            // Near the bottom of the chat (the timeline can't scroll further): everything above the message.
            menuTop = bubbleTop - menuSpace;
            reactionTop = menuTop - reactionsSpace;
        } else if (spaceBelow >= reactionsSpace + menuSpace) {
            // Near the top: everything below the message.
            reactionTop = bubbleBottom + GAP;
            menuTop = reactionTop + reactionsSpace;
        } else {
            // A message taller than the chat: reactions at the top, actions over its lower part.
            reactionTop = Math.max(bubbleTop - reactionsSpace, box.top + GAP - rootBox.top);
            menuTop = Math.max(box.bottom - GAP - menuHeight - rootBox.top, reactionTop + reactionsSpace);
        }
        side = alignRight ? rootBox.right - bubble.right : bubble.left - rootBox.left;
        positioned = true;
    }

    function run(action: () => void | Promise<void>) {
        onClose();
        Promise.resolve(action()).catch((error) => console.error(error));
    }

    function onKeyDown(event: KeyboardEvent) {
        if (event.key === "Escape") {
            event.stopPropagation();
            onClose();
        }
    }

    function openPicker() {
        onClose();
        // Anchored to the message: this menu, and the button that was tapped, go away as the picker opens.
        openReactionPicker(message, anchor);
    }

    onMount(() => {
        // Focus the first button (a quick reaction, else the first menu item) once placed: hidden buttons can't take it.
        position()
            .then(() => tick())
            .then(() => root?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true }))
            .catch((error) => console.error(error));
    });

    onDestroy(() => {
        positioned = false;
    });
</script>

<svelte:window on:keydown={onKeyDown} on:resize={onClose} />

<div bind:this={root} class="message-action-menu absolute inset-0 pointer-events-none" data-testid="messageActionMenu">
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div
        class="scrim pointer-events-auto"
        transition:fade={{ duration: 150 }}
        on:click|stopPropagation={onClose}
        on:contextmenu|preventDefault={onClose}
        data-testid="messageActionMenuScrim"
    />

    {#if $actions.react}
        <div
            class="reaction-bar pointer-events-auto"
            class:invisible={!positioned}
            style="top: {reactionTop}px; {alignRight ? 'right' : 'left'}: {side}px;"
            role="toolbar"
            aria-label={$LL.chat.messageActions.addReaction()}
            transition:scale={{ duration: 160, start: 0.85, opacity: 0 }}
        >
            {#each QUICK_REACTIONS as emoji (emoji)}
                <button
                    class="reaction"
                    aria-label={$LL.chat.messageActions.reactWith({ emoji })}
                    on:click={() => run(() => reactTo(message, emoji))}
                    data-testid={`quickReaction_${emoji}`}>{emoji}</button
                >
            {/each}
            <button
                class="reaction more"
                aria-label={$LL.chat.messageActions.addReaction()}
                title={$LL.chat.messageActions.addReaction()}
                on:click={openPicker}
                data-testid="moreReactionsButton"
            >
                <IconMoodPlus font-size={18} />
            </button>
        </div>
    {/if}

    <div
        bind:this={menuEl}
        class="menu pointer-events-auto"
        class:invisible={!positioned}
        style="top: {menuTop}px; {alignRight ? 'right' : 'left'}: {side}px;"
        role="menu"
        aria-label={$LL.chat.messageActions.menu()}
        transition:scale={{ duration: 160, start: 0.9, opacity: 0 }}
    >
        {#if $actions.reply}
            <button role="menuitem" on:click={() => run(() => replyTo(message))} data-testid="menuReplyButton">
                <span>{$LL.chat.messageActions.reply()}</span><IconArrowBackUp font-size={18} />
            </button>
        {/if}
        {#if $actions.copyText !== undefined}
            {@const text = $actions.copyText}
            <button role="menuitem" on:click={() => run(() => copyText(text))} data-testid="menuCopyTextButton">
                <span>{$LL.chat.messageActions.copyText()}</span><IconCopy font-size={18} />
            </button>
        {/if}
        {#if files.length > 0}
            <button role="menuitem" on:click={() => run(() => saveMessageFiles(files))} data-testid="menuSaveButton">
                <span>{saveLabel}</span><IconDownload font-size={18} />
            </button>
        {/if}
        {#if $actions.edit}
            <button role="menuitem" on:click={() => run(() => editMessage(message))} data-testid="menuEditButton">
                <span>{$LL.chat.messageActions.edit()}</span><IconPencil font-size={18} />
            </button>
        {/if}
        {#if $actions.delete}
            <button
                role="menuitem"
                class="danger"
                on:click={() => run(() => deleteMessage(message))}
                data-testid="menuDeleteButton"
            >
                <span>{$LL.chat.messageActions.delete()}</span><IconTrash font-size={18} />
            </button>
        {/if}
    </div>
</div>

<style lang="scss">
    /* Below the raised message, above everything else in the chat. */
    .scrim {
        position: fixed;
        inset: 0;
        z-index: -1;
        background: rgba(6, 5, 12, 0.72);
        -webkit-backdrop-filter: blur(3px);
        backdrop-filter: blur(3px);
    }

    .reaction-bar {
        position: absolute;
        z-index: 2;
        display: flex;
        align-items: center;
        gap: 2px;
        padding: 4px 6px;
        height: 46px;
        border-radius: 9999px;
        background: rgb(20 18 30 / 0.97);
        border: 1px solid rgb(167 139 250 / 0.32);
        box-shadow: 0 10px 30px rgb(0 0 0 / 0.5);
    }

    .reaction {
        width: 36px;
        height: 36px;
        display: grid;
        place-items: center;
        font-size: 22px;
        line-height: 1;
        border-radius: 9999px;
        transition: transform 120ms ease, background-color 120ms ease;
    }

    .reaction:focus-visible {
        background: rgb(255 255 255 / 0.1);
        transform: scale(1.12);
        outline: none;
    }

    @media (hover: hover) {
        .reaction:hover {
            background: rgb(255 255 255 / 0.1);
            transform: scale(1.12);
        }

        .menu button:hover {
            background: rgb(255 255 255 / 0.08);
        }
    }

    .reaction:active {
        transform: scale(0.94);
    }

    .reaction.more {
        background: rgb(255 255 255 / 0.08);
        color: rgb(255 255 255 / 0.7);
    }

    .menu {
        position: absolute;
        z-index: 2;
        min-width: 200px;
        border-radius: 14px;
        overflow: hidden;
        background: rgb(20 18 30 / 0.97);
        border: 1px solid rgb(167 139 250 / 0.32);
        box-shadow: 0 14px 40px rgb(0 0 0 / 0.55);
    }

    .menu button {
        display: flex;
        width: 100%;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
        padding: 12px 16px;
        min-height: 44px;
        font-size: 15px;
        color: #fff;
        text-align: left;
        border-bottom: 1px solid rgb(255 255 255 / 0.08);
        transition: background-color 120ms ease;
    }

    .menu button:last-child {
        border-bottom: 0;
    }

    .menu button :global(svg) {
        color: rgb(255 255 255 / 0.62);
        flex: none;
    }

    .menu button:active,
    .menu button:focus-visible {
        background: rgb(255 255 255 / 0.08);
        outline: none;
    }

    .menu button.danger,
    .menu button.danger :global(svg) {
        color: #f4a28f;
    }

    @media (prefers-reduced-motion: reduce) {
        .reaction {
            transition: none;
        }
    }
</style>
