<script lang="ts">
    import { readable } from "svelte/store";
    import type { Readable } from "svelte/store";
    import { getColorByString } from "../../../Utils/ColorGenerator";

    /** A chat picture may say it's still downloading: the circle stays plain until then, with no letter flashing. */
    export let pictureStore: Readable<string | undefined> & { loading?: Readable<boolean> };
    export let name: string;
    /** "xs" is 28px (message senders), "sm" is 32px (headers), "lg" is 40px (chat list rows), "xl" is 88px (profile). */
    export let size: "xs" | "sm" | "lg" | "xl" = "sm";
    /** Ring drawn around the avatar, in the colour of what's behind it, so stacked avatars separate. */
    export let ring = true;

    $: initial = name.trim().charAt(0) || "?";
    $: loading = pictureStore.loading ?? readable(false);
</script>

<div
    class="top-row-avatar relative shrink-0 rounded-full overflow-hidden bg-contrast-600 flex items-center justify-center {size ===
    'xl'
        ? 'h-[88px] w-[88px]'
        : size === 'lg'
        ? 'h-10 w-10'
        : size === 'xs'
        ? 'h-7 w-7'
        : 'h-8 w-8'} {ring ? 'ring-2 ring-contrast' : ''}"
    style:background-color={$pictureStore || $loading ? undefined : getColorByString(name) ?? undefined}
    title={name}
>
    {#if $pictureStore}
        <!-- The whole woka with a small margin, so hair and feet never touch the circle's edge. -->
        <img
            src={$pictureStore}
            alt=""
            class="h-full w-full object-contain p-[9%] [image-rendering:pixelated]"
            draggable="false"
        />
    {:else if !$loading}
        <span
            class="{size === 'xl'
                ? 'text-3xl'
                : size === 'lg'
                ? 'text-base'
                : 'text-xs'} font-bold uppercase text-white"
            aria-hidden="true">{initial}</span
        >
    {/if}
</div>
