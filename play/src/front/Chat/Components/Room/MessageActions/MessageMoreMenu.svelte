<script lang="ts">
    import { onMount } from "svelte";
    import type { ChatMessage } from "../../../Connection/ChatConnection";
    import LL from "../../../../../i18n/i18n-svelte";
    import { availableActions, copyText, deleteMessage, editMessage } from "./availableActions";
    import { IconCopy, IconPencil, IconTrash } from "@wa-icons";

    /** The hover bar's "More" menu: the actions that are used less often than reacting, replying and saving. */
    export let message: ChatMessage;
    /** The "More" button: pressing it again toggles the menu instead of closing and reopening it. */
    export let trigger: HTMLElement;
    export let onClose: () => void;

    const actions = availableActions(message);
    let menuEl: HTMLDivElement;

    function run(action: () => void | Promise<void>) {
        onClose();
        Promise.resolve(action()).catch((error) => console.error(error));
    }

    function onWindowPointerDown(event: PointerEvent) {
        const target = event.target;
        if (!(target instanceof Node)) return;
        if (menuEl.contains(target) || trigger.contains(target)) return;
        onClose();
    }

    function onKeyDown(event: KeyboardEvent) {
        if (event.key === "Escape") {
            onClose();
            trigger.focus();
        }
    }

    onMount(() => {
        menuEl.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
    });
</script>

<svelte:window on:pointerdown|capture={onWindowPointerDown} on:keydown={onKeyDown} />

<div bind:this={menuEl} class="more-menu" role="menu" aria-label={$LL.chat.messageActions.more()}>
    {#if $actions.copyText !== undefined}
        {@const text = $actions.copyText}
        <button role="menuitem" on:click={() => run(() => copyText(text))} data-testid="copyMessageTextButton">
            <span>{$LL.chat.messageActions.copyText()}</span><IconCopy font-size={16} />
        </button>
    {/if}
    {#if $actions.edit}
        <button role="menuitem" on:click={() => run(() => editMessage(message))} data-testid="editMessageButton">
            <span>{$LL.chat.messageActions.edit()}</span><IconPencil font-size={16} />
        </button>
    {/if}
    {#if $actions.delete}
        <button
            role="menuitem"
            class="danger"
            on:click={() => run(() => deleteMessage(message))}
            data-testid="removeMessageButton"
        >
            <span>{$LL.chat.messageActions.delete()}</span><IconTrash font-size={16} />
        </button>
    {/if}
</div>

<style lang="scss">
    .more-menu {
        min-width: 176px;
        border-radius: 12px;
        overflow: hidden;
        background: rgb(20 18 30 / 0.98);
        border: 1px solid rgb(167 139 250 / 0.32);
        box-shadow: 0 12px 32px rgb(0 0 0 / 0.5);
    }

    .more-menu button {
        display: flex;
        width: 100%;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
        padding: 9px 12px;
        font-size: 13px;
        color: #fff;
        text-align: left;
        border-bottom: 1px solid rgb(255 255 255 / 0.08);
    }

    .more-menu button:last-child {
        border-bottom: 0;
    }

    .more-menu button :global(svg) {
        color: rgb(255 255 255 / 0.62);
    }

    .more-menu button:hover,
    .more-menu button:focus-visible {
        background: rgb(255 255 255 / 0.08);
        outline: none;
    }

    .more-menu button.danger,
    .more-menu button.danger :global(svg) {
        color: #f4a28f;
    }
</style>
