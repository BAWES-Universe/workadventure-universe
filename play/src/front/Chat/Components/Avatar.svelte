<script lang="ts">
    import { readable } from "svelte/store";
    import type { Readable } from "svelte/store";
    import { getColorByString } from "../../Utils/ColorGenerator";
    import type { PictureStore } from "../../Stores/PictureStore";

    /** A chat picture may say it's still downloading: no letter is shown until then, so none flashes. */
    export let pictureStore: (PictureStore & { loading?: Readable<boolean> }) | undefined;
    export let fallbackName = "A";
    export let color: string | null = null;
    export let isChatAvatar = false;
    /** "lg" is the 40px avatar of the chat list rows; "sm" is the historical default. */
    export let size: "sm" | "lg" = "sm";
    export let round = false;

    $: shapeClass = round ? "rounded-full" : size === "lg" ? "rounded-lg" : "rounded-sm";
    $: loading = pictureStore?.loading ?? readable(false);
</script>

{#if $pictureStore}
    <img
        src={$pictureStore}
        alt="User avatar"
        class="{shapeClass} {size === 'lg' ? 'h-10 w-10 object-cover' : 'h-6 w-6 object-contain'} bg-white"
        draggable="false"
        style:background-color={`${color ? color : `${getColorByString(fallbackName)}`}`}
    />
{:else}
    <div
        class:chatAvatar={isChatAvatar}
        class="{shapeClass} bg-amber-600 {size === 'lg'
            ? 'h-10 w-10 text-base'
            : 'h-7 w-7'} text-center uppercase text-white flex items-center justify-center font-bold"
        draggable="false"
        style:background-color={`${color ? color : getColorByString(fallbackName)}`}
    >
        {#if !$loading}
            {fallbackName.charAt(0)}
        {/if}
    </div>
{/if}

<style>
    .chatAvatar {
        border-style: solid;
        border-color: rgb(27 42 65 / 0.95);
        border-width: 1px;
    }
</style>
