<script lang="ts">
    import type { Readable } from "svelte/store";
    import { getColorByString } from "../../../Utils/ColorGenerator";

    export let pictureStore: Readable<string | undefined>;
    export let name: string;
    /** "sm" is 32px (top row stacks), "lg" is 40px (chat list rows). */
    export let size: "sm" | "lg" = "sm";
    /** Ring drawn around the avatar, in the colour of what's behind it, so stacked avatars separate. */
    export let ring = true;

    $: initial = name.trim().charAt(0) || "?";
</script>

<div
    class="top-row-avatar relative shrink-0 rounded-full overflow-hidden bg-contrast-600 flex items-center justify-center {size ===
    'lg'
        ? 'h-10 w-10'
        : 'h-8 w-8'} {ring ? 'ring-2 ring-contrast' : ''}"
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
        <span class="{size === 'lg' ? 'text-base' : 'text-xs'} font-bold uppercase text-white" aria-hidden="true"
            >{initial}</span
        >
    {/if}
</div>
