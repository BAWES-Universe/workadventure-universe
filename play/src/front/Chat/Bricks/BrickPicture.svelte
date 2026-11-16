<script lang="ts">
    import { brickPictureUrl, isBrickLook } from "./Brick";
    import { brickPicture } from "./BrickLookPicture";

    /**
     * A Brick's look as a picture (game #1996): one of the Brick pictures, or the WOKA it wears. While a WOKA is being
     * drawn the place stays empty, so nothing jumps when it arrives.
     */
    export let look: string | null | undefined;
    export let size = 32;

    $: woka = look && !isBrickLook(look) ? brickPicture(look) : undefined;
    $: src = woka ? $woka : brickPictureUrl(look);
</script>

{#if src}
    <img {src} alt="" draggable="false" width={size} height={size} class="bk-look" />
{:else}
    <span class="bk-look" style="width:{size}px;height:{size}px" />
{/if}

<style>
    .bk-look {
        display: block;
        flex: none;
        image-rendering: pixelated;
    }
</style>
