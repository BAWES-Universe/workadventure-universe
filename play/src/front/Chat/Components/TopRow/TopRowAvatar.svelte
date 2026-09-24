<script lang="ts">
    import type { Readable } from "svelte/store";
    import { getColorByString } from "../../../Utils/ColorGenerator";

    export let pictureStore: Readable<string | undefined>;
    export let name: string;

    $: initial = name.trim().charAt(0) || "?";
</script>

<div
    class="top-row-avatar relative h-8 w-8 shrink-0 rounded-full overflow-hidden ring-2 ring-contrast bg-contrast-600 flex items-center justify-center"
    style:background-color={$pictureStore ? undefined : getColorByString(name) ?? undefined}
    title={name}
>
    {#if $pictureStore}
        <img
            src={$pictureStore}
            alt=""
            class="h-full w-full object-contain [image-rendering:pixelated]"
            draggable="false"
        />
    {:else}
        <span class="text-xs font-bold uppercase text-white" aria-hidden="true">{initial}</span>
    {/if}
</div>
