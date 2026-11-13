<script lang="ts">
    import type { ComponentType } from "svelte";
    import { IconChevronRight } from "@wa-icons";

    /**
     * One row of an Apps page: a picture, a name with one line under it, and what is at the end of it. A row that opens a
     * page is one button with an arrow; a row with its own button inside it (Connect, Remove, Let it use) is not.
     */
    export let title: string;
    export let hint: string | undefined = undefined;
    export let icon: ComponentType | undefined = undefined;
    /** The row opens something: one tap target with an arrow at its end */
    export let onTap: (() => void) | undefined = undefined;
    /** The hint is a warning (an amber line) */
    export let warn = false;
    /** A small mark in front of the hint line (the crown of the universe's owner) */
    export let hintIcon: ComponentType | undefined = undefined;
    export let testId: string | undefined = undefined;
</script>

{#if onTap}
    <button type="button" class="ar" data-testid={testId} on:click={onTap}>
        {#if icon}<span class="ar-ico"><svelte:component this={icon} font-size="22" /></span>{/if}
        <span class="ar-tx">
            <span class="ar-t">{title}</span>
            {#if hint}<span class="ar-m" class:warn class:ar-with-icon={!!hintIcon}
                    >{#if hintIcon}<svelte:component this={hintIcon} font-size="13" />{/if}{hint}</span
                >{/if}
        </span>
        <slot />
        <span class="ar-chev"><IconChevronRight font-size="18" /></span>
    </button>
{:else}
    <div class="ar" data-testid={testId}>
        {#if icon}<span class="ar-ico"><svelte:component this={icon} font-size="22" /></span>{/if}
        <span class="ar-tx">
            <span class="ar-t">{title}</span>
            {#if hint}<span class="ar-m" class:warn class:ar-with-icon={!!hintIcon}
                    >{#if hintIcon}<svelte:component this={hintIcon} font-size="13" />{/if}{hint}</span
                >{/if}
        </span>
        <slot />
    </div>
{/if}

<style>
    .ar {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        min-height: 56px;
        margin: 0;
        padding: 6px 4px 6px 8px;
        border: 0;
        border-radius: 14px;
        background: transparent;
        box-sizing: border-box;
        font: inherit;
        color: #fff;
        text-align: start;
    }
    button.ar {
        cursor: pointer;
    }
    @media (hover: hover) {
        button.ar:hover {
            background: rgba(255, 255, 255, 0.05);
        }
    }
    button.ar:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: -2px;
    }
    .ar-ico {
        display: grid;
        place-items: center;
        flex: none;
        width: 32px;
        height: 32px;
        color: #fff;
    }
    .ar-tx {
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
    }
    .ar-t {
        font-size: 14px;
        font-weight: 600;
        overflow-wrap: anywhere;
    }
    .ar-m {
        font-size: 12.5px;
        line-height: 1.35;
        color: rgba(244, 242, 250, 0.64);
        overflow-wrap: anywhere;
    }
    .ar-m.ar-with-icon {
        display: inline-flex;
        align-items: center;
        gap: 4px;
    }
    .ar-m.warn {
        color: #f5c451;
    }
    .ar-chev {
        display: grid;
        place-items: center;
        flex: none;
        color: rgba(244, 242, 250, 0.64);
    }
    :global([dir="rtl"]) .ar-chev {
        transform: scaleX(-1);
    }
</style>
