<script lang="ts">
    import { closedItemsStore, undoClosedItems } from "../../Stores/ClosedItemsStore";
    import { bringOpenHereInFront } from "../../Stores/SideWindowInFrontStore";
    import LL from "../../../i18n/i18n-svelte";

    function undo() {
        undoClosedItems();
        bringOpenHereInFront();
    }
</script>

{#if $closedItemsStore}
    <!-- Closing two or more items at once is not asked about first: it can be undone for a few seconds. -->
    <div class="closed-items u-surface" role="status" data-testid="closedItemsToast">
        <span>{$LL.cowebsite.closedItems({ count: $closedItemsStore.closed.length })}</span>
        <button type="button" on:click={undo} data-testid="closedItemsUndo">{$LL.cowebsite.undo()}</button>
    </div>
{/if}

<style>
    .closed-items {
        position: fixed;
        inset-inline-start: 50%;
        transform: translateX(-50%);
        bottom: calc(40px + env(safe-area-inset-bottom, 0px));
        z-index: 2100;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        gap: 12px;
        max-width: calc(100vw - 32px);
        padding: 6px 6px 6px 20px;
        border-radius: 999px;
        color: #fff;
        font-family: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        font-size: 14px;
        white-space: nowrap;
    }

    /* Phones: the bar is at the bottom, so the toast sits above it, like the popups (MainLayout.svelte). Same query. */
    @media (max-height: 960px) and (max-width: 480px) and (pointer: coarse),
        (max-height: 480px) and (max-width: 960px) and (pointer: coarse) {
        .closed-items {
            bottom: calc(6rem + max(0px, env(safe-area-inset-bottom, 0px) - 21px));
        }
    }

    :global(html[dir="rtl"]) .closed-items {
        transform: translateX(50%);
    }

    .closed-items button {
        box-sizing: border-box;
        height: 44px;
        padding: 0 16px;
        border: 0;
        border-radius: 999px;
        font-family: inherit;
        font-size: 14px;
        font-weight: 700;
        color: #fff;
        background: rgba(255, 255, 255, 0.1);
        cursor: pointer;
    }

    .closed-items button:hover {
        background: rgba(255, 255, 255, 0.16);
    }
</style>
