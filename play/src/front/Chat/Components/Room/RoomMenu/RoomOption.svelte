<script lang="ts">
    import type { ComponentType } from "svelte";
    import { createEventDispatcher } from "svelte";

    export let IconComponent: ComponentType;
    export let title: string;
    export let dataTestId: string | undefined = undefined;
    /** Extra classes on the row: "u-danger" for a destructive choice, or a fill of its own. */
    export let bg = "";
    export let disabled = false;
    const dispatch = createEventDispatcher<{
        click: void;
    }>();
</script>

<!-- A row of the game's menus (profile menu, map tools): same font, colours and icon slot, so it never takes the
     browser's own button font or iOS blue. -->
<button
    type="button"
    class="u-menu-row {bg}"
    data-testid={dataTestId}
    on:click|stopPropagation|preventDefault={() => dispatch("click")}
    {disabled}
>
    <span class="u-menu-tile" aria-hidden="true"><svelte:component this={IconComponent} /></span>
    <span class="u-menu-label">{title}</span>
</button>
