<script lang="ts">
    /**
     * An on/off row of a property panel: the label on the left, the game's purple-to-blue switch on the right, the
     * whole row (at least 44px tall) taking the tap. A real checkbox sits under the switch, so keyboards, screen
     * readers and the tests keep working with it by its id.
     */
    export let id: string;
    export let label: string;
    export let value = false;
    export let disabled = false;
    /** A section's own switch (Advanced Options): the label is bolder */
    export let strong = false;
    export let onChange: () => void = () => {};
</script>

<label class="ps-row" class:ps-strong={strong} class:ps-disabled={disabled} data-testid="{id}-row">
    <span class="ps-label">{label}</span>
    <input {id} type="checkbox" class="sr-only ps-input" bind:checked={value} on:change={onChange} {disabled} />
    <span class="u-switch ps-switch" aria-checked={value} data-testid={id} />
</label>

<style>
    .ps-row {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        min-height: 44px;
        margin: 0;
        font-size: 0.9375rem;
        color: rgba(255, 255, 255, 0.92);
        cursor: pointer;
    }
    .ps-row.ps-strong {
        font-weight: 600;
        color: #fff;
    }
    .ps-label {
        min-width: 0;
    }
    .ps-row.ps-disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
    .ps-input:focus-visible + .ps-switch {
        outline: 2px solid #fff;
        outline-offset: 2px;
    }
</style>
