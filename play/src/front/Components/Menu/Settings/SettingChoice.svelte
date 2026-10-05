<script lang="ts">
    import { slide } from "svelte/transition";
    import { IconCheck, IconChevronDown } from "@wa-icons";

    /**
     * A choice shown as one row with its value. Tapped, the options open underneath, picked the way you pick your
     * status in the profile menu: the chosen one is tinted and bold, with a check. Only one choice is open at a time:
     * the settings page passes which one in `open`.
     */
    type Option = { value: string; label: string; hint?: string };

    export let id: string;
    export let label: string;
    /** A shorter label for the two columns of a computer, where the long one would wrap. */
    export let wideLabel: string | undefined = undefined;
    export let value: string;
    export let options: Option[];
    export let open = false;
    export let onToggle: () => void;
    export let onSelect: (value: string) => void;

    $: current = options.find((option) => option.value === value);
</script>

<div class="u-set-choice" data-testid={id}>
    <!-- A control of its own (the join sound's play button) sits over a gap left in the row for it: inside the row's
         button it would be a button within a button, which screen readers can't reach on its own. -->
    <div class="u-set-choice-line">
        <button
            type="button"
            class="u-set-row u-set-choice-head"
            aria-expanded={open}
            aria-controls="{id}-options"
            on:click={onToggle}
        >
            <span class="u-set-text">
                {#if wideLabel}
                    <span class="u-set-label u-set-label-phone">{label}</span>
                    <span class="u-set-label u-set-label-wide">{wideLabel}</span>
                {:else}
                    <span class="u-set-label">{label}</span>
                {/if}
            </span>
            <span class="u-set-value">{current?.label ?? value}</span>
            {#if $$slots.extra}
                <span class="u-set-extra-gap" aria-hidden="true" />
            {/if}
            <IconChevronDown class="u-set-chevron {open ? 'is-open' : ''}" font-size="16" />
        </button>
        {#if $$slots.extra}
            <span class="u-set-extra"><slot name="extra" /></span>
        {/if}
    </div>
    {#if open}
        <div
            class="u-set-options"
            id="{id}-options"
            role="listbox"
            aria-label={label}
            transition:slide={{ duration: 150 }}
        >
            {#each options as option (option.value)}
                <button
                    type="button"
                    role="option"
                    aria-selected={option.value === value}
                    class="u-menu-row u-set-option"
                    class:u-selected={option.value === value}
                    on:click={() => onSelect(option.value)}
                >
                    <span class="u-menu-label">{option.label}</span>
                    {#if option.hint}
                        <span class="u-set-option-hint">{option.hint}</span>
                    {/if}
                    {#if option.value === value}
                        <IconCheck class="u-set-option-check" font-size="18" />
                    {/if}
                </button>
            {/each}
        </div>
    {/if}
</div>
