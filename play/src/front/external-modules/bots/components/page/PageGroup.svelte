<script lang="ts">
    // One group of the bot page: an icon, its title and one line saying what it is set to. Tapping it opens the
    // group's settings underneath; the page keeps one group open at a time.
    import type { ComponentType } from "svelte";
    import { IconChevronDown } from "@wa-icons";

    export let id: string;
    export let icon: ComponentType;
    export let title: string;
    export let brief: string;
    export let open = false;
    export let onToggle: (id: string) => void;
    /** Only the settings, without the group's own row: for a group shown inside another one. */
    export let bare = false;
    /** The row opens a screen of its own (a picker) rather than settings underneath. */
    export let link = false;
</script>

{#if bare}
    <slot />
{:else}
    <section class="bp-group" class:open data-testid="bot-page-group-{id}">
        <button
            type="button"
            class="bp-head"
            aria-expanded={link ? undefined : open}
            aria-controls={link ? undefined : `bot-page-body-${id}`}
            on:click={() => onToggle(id)}
        >
            <span class="bp-ico"><svelte:component this={icon} font-size="20" /></span>
            <span class="bp-tx">
                <span class="bp-t">{title}</span>
                <span class="bp-m">{brief}</span>
            </span>
            <span class="bp-chev"><IconChevronDown font-size="18" /></span>
        </button>
        {#if open && !link}
            <div class="bp-body" id="bot-page-body-{id}">
                <slot />
            </div>
        {/if}
    </section>
{/if}

<style>
    .bp-group {
        border-radius: 14px;
    }
    .bp-group.open {
        background: rgba(255, 255, 255, 0.05);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.18);
    }
    .bp-head {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        margin: 0;
        padding: 8px;
        border: 0;
        border-radius: 14px;
        background: transparent;
        font: inherit;
        color: #fff;
        text-align: left;
        cursor: pointer;
    }
    @media (hover: hover) {
        .bp-group:not(.open) .bp-head:hover {
            background: rgba(255, 255, 255, 0.05);
        }
    }
    .bp-head:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: -2px;
    }
    /* Plain white icon, like the menu: no tile behind it. */
    .bp-ico {
        display: grid;
        place-items: center;
        flex: none;
        width: 32px;
        height: 32px;
        color: rgba(255, 255, 255, 0.85);
    }
    .open .bp-ico {
        color: #fff;
    }
    .bp-tx {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 0;
    }
    .bp-t,
    .bp-m {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .bp-t {
        font-size: 14px;
        font-weight: 500;
    }
    .open .bp-t {
        font-weight: 650;
    }
    .bp-m {
        font-size: 12.5px;
        line-height: 1.3;
        color: rgba(244, 242, 250, 0.64);
    }
    .bp-chev {
        display: grid;
        place-items: center;
        flex: none;
        color: rgba(244, 242, 250, 0.64);
        transform: rotate(-90deg);
    }
    :global([dir="rtl"]) .bp-chev {
        transform: rotate(90deg);
    }
    .open .bp-chev {
        transform: none;
        color: #fff;
    }
    .bp-body {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 2px 10px 12px;
    }
</style>
