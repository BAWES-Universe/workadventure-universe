<script lang="ts">
    /**
     * The one row every item in the Open here window gets, built like chat's header: the item's icon, its name (16 px
     * bold) with a line under it (12 px), then the actions that make sense for the item as plain icons. Mark an action
     * button with the class `open-here-action`; a picked one (the file's page list) also gets `picked`. In a phone's
     * sheet the row ends with the "N open" chip (with two or more open, it opens the list) and chat's own close.
     */
    import LL from "../../../i18n/i18n-svelte";
    import { coWebsites } from "../../Stores/CoWebsiteStore";
    import { closeAllOpenItems } from "../../Stores/ClosedItemsStore";
    import { openHereListOpenStore, openHereSheetLayoutStore } from "../../Stores/OpenHereSheetStore";
    import { IconChevronDown, IconX } from "@wa-icons";

    export let name: string;
    export let line: string | undefined = undefined;
</script>

<header class="open-here-row" data-testid="openHereRow">
    <span class="row-icon"><slot name="icon" /></span>
    <div class="row-text">
        <b>{name}</b>
        {#if line}<small>{line}</small>{/if}
    </div>
    <slot />
    {#if $openHereSheetLayoutStore}
        {#if $coWebsites.length > 1}
            <button
                type="button"
                class="row-chip"
                data-open-chip
                aria-expanded={$openHereListOpenStore}
                aria-haspopup="true"
                aria-label={$LL.cowebsite.openCount({ count: $coWebsites.length })}
                data-testid="openHereList"
                on:click={() => openHereListOpenStore.update((open) => !open)}
            >
                {$coWebsites.length}
                <IconChevronDown font-size="16" />
            </button>
        {/if}
        <button
            type="button"
            class="u-close"
            aria-label={$LL.chat.fileViewer.close()}
            title={$LL.chat.fileViewer.close()}
            data-testid="openHereSheetClose"
            on:click={closeAllOpenItems}
        >
            <IconX font-size="20" />
        </button>
    {/if}
</header>

<style>
    .open-here-row {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 8px;
        min-height: 64px;
        box-sizing: border-box;
        flex: none;
        color: #fff;
        font-family: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }

    .row-icon {
        display: inline-flex;
        flex: none;
        margin-inline: 8px 6px;
    }

    .row-text {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
    }

    .row-text b {
        display: block;
        font-size: 16px;
        font-weight: 700;
        line-height: 20px;
        text-transform: none;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .row-text small {
        display: block;
        font-size: 12px;
        line-height: 16px;
        color: rgba(255, 255, 255, 0.6);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    /* "N open" on a phone: the count only, so the name keeps its room. Neutral; only its arrow turns. */
    .row-chip {
        box-sizing: border-box;
        display: inline-flex;
        flex: none;
        align-items: center;
        justify-content: center;
        gap: 4px;
        height: 40px;
        min-width: 56px;
        margin-inline: 4px;
        padding: 0 8px 0 14px;
        border: 0;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        color: #fff;
        font-family: inherit;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
    }

    .row-chip[aria-expanded="true"] {
        background: rgba(255, 255, 255, 0.14);
    }

    .row-chip[aria-expanded="true"] :global(svg) {
        transform: rotate(180deg);
    }

    /* Plain icons with no box, 48 px to tap, a soft white on hover only where hovering exists. */
    .open-here-row :global(.open-here-action) {
        display: inline-flex;
        flex: none;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        width: 48px;
        height: 48px;
        margin: 0;
        padding: 0;
        border: 0;
        border-radius: 16px;
        background: transparent;
        color: rgba(255, 255, 255, 0.85);
        font-family: inherit;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
    }

    @media (hover: hover) {
        .open-here-row :global(.open-here-action:hover:not(:disabled)) {
            color: #fff;
            background: rgba(255, 255, 255, 0.1);
        }
    }

    .open-here-row :global(.open-here-action:focus-visible) {
        outline: none;
        box-shadow: inset 0 0 0 2px #fff;
    }

    .open-here-row :global(.open-here-action:disabled) {
        opacity: 0.4;
        cursor: default;
    }

    /* On, like a picked option: soft violet, never the gradient (that is for the one main button). */
    .open-here-row :global(.open-here-action.picked) {
        color: #fff;
        background: rgba(134, 41, 252, 0.14);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.7);
    }
</style>
