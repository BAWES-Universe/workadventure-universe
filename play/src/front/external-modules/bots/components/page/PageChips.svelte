<script lang="ts" generics="T">
    // A row of round choices, one picked (Loop / Back & forth, 0 s / 5 s / 30 s / 1 min).
    export let label: string;
    export let options: Array<{ value: T; label: string }>;
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
            on:click={() => onPick(option.value)}>{option.label}</button
        >
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
        height: 28px;
        margin: 0;
        padding: 0 11px;
        border: 0;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.06);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.18);
        font: inherit;
        font-size: 12.5px;
        font-weight: 500;
        color: #fff;
        white-space: nowrap;
        cursor: pointer;
    }
    @media (hover: hover) {
        .bp-chip:not(.on):hover {
            background: rgba(255, 255, 255, 0.12);
        }
    }
    .bp-chip:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 2px;
    }
    .bp-chip.on {
        background: linear-gradient(135deg, #8629fc, #4156f6);
        box-shadow: none;
    }
</style>
