<script lang="ts">
    /**
     * One frame of a companion's 3 × 4 sprite sheet (32px frames), drawn crisp at any size. Rows are the
     * directions (0 down, 1 left, 2 right, 3 up); the middle column is the standing frame.
     */
    export let url: string;
    export let size = 64;
    export let row = 0;

    $: cssUrl = 'url("' + url.replace(/["\\\n]/g, (c) => "\\" + c) + '")';
</script>

<span
    class="companion-sprite"
    style="--s: {size}px; width: {size}px; height: {size}px; background-image: {cssUrl}; background-position-y: {-row *
        size}px;"
    aria-hidden="true"
/>

<style>
    .companion-sprite {
        display: block;
        flex: none;
        background-repeat: no-repeat;
        background-size: calc(var(--s) * 3) calc(var(--s) * 4);
        background-position-x: calc(var(--s) * -1);
        image-rendering: pixelated;
    }
</style>
