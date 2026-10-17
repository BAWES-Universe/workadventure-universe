<script lang="ts" generics="T">
    // Three choices in one pill, one picked (Stays put / Wanders / Walks a route).
    export let label: string;
    export let options: Array<{ value: T; label: string; testId?: string }>;
    export let value: T;
    export let onPick: (value: T) => void;
</script>

<div class="bp-seg" role="radiogroup" aria-label={label}>
    {#each options as option (option.label)}
        <button
            type="button"
            role="radio"
            class:on={option.value === value}
            aria-checked={option.value === value}
            data-testid={option.testId}
            on:click={() => onPick(option.value)}>{option.label}</button
        >
    {/each}
</div>

<style>
    .bp-seg {
        display: flex;
        padding: 3px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.06);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
    }
    .bp-seg button {
        flex: 1 1 auto;
        min-width: 0;
        margin: 0;
        height: 44px;
        padding: 0 6px;
        border: 0;
        border-radius: 999px;
        background: transparent;
        font: inherit;
        font-size: 13px;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.62);
        text-align: center;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        cursor: pointer;
    }
    @media (hover: hover) {
        .bp-seg button:not(.on):hover {
            color: #fff;
        }
    }
    .bp-seg button:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: -2px;
    }
    .bp-seg button.on {
        background: rgba(134, 41, 252, 0.16);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.7);
        color: #fff;
        font-weight: 700;
    }
</style>
