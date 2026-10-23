<script lang="ts">
    import LL from "../../../i18n/i18n-svelte";
    import { IconChevronDown } from "@wa-icons";

    /**
     * "N open": the chip that opens the list of everything open. Neutral whether the list is showing or not; only its
     * arrow turns. On a phone's sheet it is just the number, in the item's row.
     */
    export let count: number;
    export let open: boolean;
    export let short = false;
</script>

<button
    type="button"
    class="open-chip"
    class:short
    aria-expanded={open}
    aria-haspopup="true"
    aria-label={$LL.cowebsite.openList()}
    data-testid="openHereList"
    data-open-chip
    on:click
>
    {short ? count : $LL.cowebsite.openCount({ count })}
    <IconChevronDown font-size="16" />
</button>

<style>
    .open-chip {
        box-sizing: border-box;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        flex: none;
        height: 40px;
        margin-inline: 8px;
        padding: 0 10px 0 14px;
        border: 0;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        color: #fff;
        font-family: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        font-size: 14px;
        font-weight: 600;
        white-space: nowrap;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
    }

    /* In the row of a phone's sheet: 44px to tap, with a little less room around it. */
    .open-chip.short {
        height: 44px;
        margin-inline: 2px;
    }

    .open-chip:hover,
    .open-chip[aria-expanded="true"] {
        background: rgba(255, 255, 255, 0.14);
    }

    .open-chip[aria-expanded="true"] :global(svg) {
        transform: rotate(180deg);
    }
</style>
