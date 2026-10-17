<script lang="ts" generics="T">
    // A row of round choices, one picked (Loop / Back & forth, 0 s / 5 s / 30 s / 1 min, Down / Left / Right / Up).
    import type { ComponentType } from "svelte";
    import { IconCheck } from "@wa-icons";

    export let label: string;
    export let options: Array<{ value: T; label: string; icon?: ComponentType }>;
    export let value: T;
    export let onPick: (value: T) => void;
</script>

<div class="bp-chips" role="radiogroup" aria-label={label}>
    {#each options as option (option.label)}
        <button
            type="button"
            role="radio"
            class="bp-chip"
            class:on={option.value === value}
            aria-checked={option.value === value}
            on:click={() => onPick(option.value)}
        >
            {#if option.value === value}<span class="bp-check"><IconCheck font-size="14" stroke-width="3" /></span>{/if}
            {#if option.icon}<span class="bp-ico"><svelte:component this={option.icon} font-size="16" /></span>{/if}
            {option.label}
        </button>
    {/each}
</div>

<style>
    .bp-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
    }
    .bp-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        box-sizing: border-box;
        height: 44px;
        margin: 0;
        padding: 0 14px;
        border: 1px solid rgba(243, 241, 250, 0.15);
        border-radius: 999px;
        background: transparent;
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        color: #fff;
        white-space: nowrap;
        cursor: pointer;
    }
    .bp-check,
    .bp-ico {
        display: inline-flex;
        align-items: center;
    }
    .bp-check {
        color: #fff;
    }
    @media (hover: hover) {
        .bp-chip:not(.on):hover {
            background: rgba(255, 255, 255, 0.08);
        }
    }
    .bp-chip:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 2px;
    }
    .bp-chip.on {
        background: rgba(134, 41, 252, 0.16);
        border-color: rgba(167, 139, 250, 0.7);
        font-weight: 700;
    }
</style>
