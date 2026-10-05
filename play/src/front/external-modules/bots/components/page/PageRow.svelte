<script lang="ts">
    // A row inside a group: an optional icon, a title with one line under it, and a trailing control.
    import type { ComponentType } from "svelte";

    export let title: string;
    export let hint: string | undefined = undefined;
    export let icon: ComponentType | undefined = undefined;
    /** The row shows a value that is in use (the row gets a light fill). */
    export let on = false;
</script>

<div class="bp-row" class:on>
    {#if icon}
        <span class="bp-ico"><svelte:component this={icon} font-size="20" /></span>
    {/if}
    <div class="bp-tx">
        <div class="bp-t">{title}</div>
        {#if hint}<div class="bp-m">{hint}</div>{/if}
    </div>
    <slot />
</div>

<style>
    .bp-row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 6px 8px;
        border-radius: 12px;
    }
    .bp-row.on {
        background: rgba(255, 255, 255, 0.08);
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
    .on .bp-ico {
        color: #fff;
    }
    .bp-tx {
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
        font-weight: 600;
    }
    .bp-m {
        font-size: 12.5px;
        line-height: 1.3;
        color: rgba(244, 242, 250, 0.64);
    }
</style>
