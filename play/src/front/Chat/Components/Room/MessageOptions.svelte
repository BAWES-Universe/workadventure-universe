<script lang="ts">
    import { onDestroy } from "svelte";
    import type { ChatMessage } from "../../Connection/ChatConnection";
    import LL from "../../../../i18n/i18n-svelte";
    import { showFloatingUi } from "../../../Utils/svelte-floatingui-show";
    import { DESKTOP_QUICK_REACTIONS, areAllPhotos } from "./MessageActions/messageActions";
    import {
        availableActions,
        openReactionPicker,
        reactTo,
        replyTo,
        saveMessageFiles,
    } from "./MessageActions/availableActions";
    import MessageMoreMenu from "./MessageActions/MessageMoreMenu.svelte";
    import { IconArrowBackUp, IconDots, IconDownload, IconMoodPlus } from "@wa-icons";

    /** The bar shown over a message on hover or keyboard focus: quick reactions, React, Reply and More. */
    export let message: ChatMessage;
    export let messageRef: HTMLDivElement | undefined;
    /** True while the "More" menu or the emoji picker is open, so the bar stays visible. */
    export let open = false;

    const actions = availableActions(message);

    let moreButton: HTMLButtonElement;
    let closeMore: (() => void) | undefined;
    let closePicker: (() => void) | undefined;

    $: files = $actions.files;
    $: hasMore = $actions.copyText !== undefined || $actions.edit || $actions.delete;
    $: saveLabel = areAllPhotos(files)
        ? files.length > 1
            ? $LL.chat.messageActions.savePhotos({ count: files.length })
            : $LL.chat.messageActions.savePhoto()
        : files.length > 1
        ? $LL.chat.messageActions.saveFiles({ count: files.length })
        : $LL.chat.messageActions.saveFile();
    $: open = closeMore !== undefined || closePicker !== undefined;

    function toggleMore() {
        if (closeMore) {
            closeMore();
            return;
        }
        const destroy = showFloatingUi(
            moreButton,
            MessageMoreMenu,
            {
                message,
                trigger: moreButton,
                onClose: () => closeMore?.(),
            },
            { placement: "bottom-end" },
            6,
            false
        );
        closeMore = () => {
            destroy();
            closeMore = undefined;
        };
    }

    function togglePicker(event: MouseEvent) {
        if (closePicker) {
            closePicker();
            return;
        }
        const anchor = messageRef ?? (event.currentTarget as Element);
        closePicker = openReactionPicker(message, anchor, () => (closePicker = undefined));
    }

    onDestroy(() => {
        closeMore?.();
        closePicker?.();
    });
</script>

<div class="message-bar" role="toolbar" aria-label={$LL.chat.messageActions.menu()}>
    {#if $actions.react}
        {#each DESKTOP_QUICK_REACTIONS as emoji (emoji)}
            <button
                class="bar-button emoji"
                title={$LL.chat.messageActions.reactWith({ emoji })}
                aria-label={$LL.chat.messageActions.reactWith({ emoji })}
                on:click={() => reactTo(message, emoji)}
                data-testid={`quickReaction_${emoji}`}>{emoji}</button
            >
        {/each}
        <span class="separator" aria-hidden="true" />
        <button
            class="bar-button"
            class:open={closePicker !== undefined}
            title={$LL.chat.messageActions.addReaction()}
            aria-label={$LL.chat.messageActions.addReaction()}
            on:click={togglePicker}
            data-testid="openEmojiPickerButton"
        >
            <IconMoodPlus font-size={18} />
        </button>
    {/if}
    {#if $actions.reply}
        <button
            class="bar-button"
            title={$LL.chat.messageActions.reply()}
            aria-label={$LL.chat.messageActions.reply()}
            on:click={() => replyTo(message)}
            data-testid="replyToMessageButton"
        >
            <IconArrowBackUp font-size={18} />
        </button>
    {/if}
    {#if files.length > 0}
        <button
            class="bar-button"
            title={saveLabel}
            aria-label={saveLabel}
            on:click={() => saveMessageFiles(files)}
            data-testid="saveMessageFilesButton"
        >
            <IconDownload font-size={18} />
        </button>
    {/if}
    {#if hasMore}
        <button
            bind:this={moreButton}
            class="bar-button"
            class:open={closeMore !== undefined}
            title={$LL.chat.messageActions.more()}
            aria-label={$LL.chat.messageActions.more()}
            aria-haspopup="menu"
            aria-expanded={closeMore !== undefined}
            on:click={toggleMore}
            data-testid="messageMoreButton"
        >
            <IconDots font-size={18} />
        </button>
    {/if}
</div>

<style lang="scss">
    .message-bar {
        display: flex;
        align-items: center;
        gap: 1px;
        padding: 3px;
        border-radius: 12px;
        background: rgb(20 18 30 / 0.97);
        border: 1px solid rgb(167 139 250 / 0.32);
        box-shadow: 0 8px 22px rgb(0 0 0 / 0.5);
    }

    .bar-button {
        width: 30px;
        height: 30px;
        display: grid;
        place-items: center;
        border-radius: 9px;
        color: rgb(255 255 255 / 0.75);
        transition: background-color 120ms ease, color 120ms ease;
    }

    .bar-button.emoji {
        font-size: 17px;
        line-height: 1;
    }

    .bar-button:hover,
    .bar-button:focus-visible {
        background: rgb(255 255 255 / 0.1);
        color: #fff;
        outline: none;
    }

    /* Open state is grey, like every other open button in the game. */
    .bar-button.open {
        background: rgb(255 255 255 / 0.14);
        color: #fff;
    }

    .separator {
        width: 1px;
        height: 18px;
        margin: 0 2px;
        background: rgb(255 255 255 / 0.1);
    }
</style>
