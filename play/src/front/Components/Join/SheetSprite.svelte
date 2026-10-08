<script lang="ts">
    /**
     * One frame of a 3 × 4 sprite sheet (WOKA or companion, 32px frames), drawn crisp at any size. Rows are the
     * directions (0 down, 1 left, 2 right, 3 up). Walking plays the game's cycle: columns 0, 1, 2, 1 at 10 a second.
     */
    export let url: string;
    export let size = 64;
    export let row = 0;
    export let walking = false;
    export let classList = "";

    $: cssUrl = 'url("' + url.replace(/["\\\n]/g, (c) => "\\" + c) + '")';
</script>

<span
    class="sheet-sprite {classList}"
    class:walking
    style="--s: {size}px; width: {size}px; height: {size}px; background-image: {cssUrl}; background-position-y: {-row *
        size}px;"
    aria-hidden="true"
/>

<style lang="scss">
    .sheet-sprite {
        display: block;
        flex: none;
        background-repeat: no-repeat;
        background-size: calc(var(--s) * 3) calc(var(--s) * 4);
        background-position-x: calc(var(--s) * -1);
        image-rendering: pixelated;
    }
    .walking {
        animation: sheet-walk 400ms steps(1) infinite;
    }
    @keyframes sheet-walk {
        0% {
            background-position-x: 0;
        }
        25% {
            background-position-x: calc(var(--s) * -1);
        }
        50% {
            background-position-x: calc(var(--s) * -2);
        }
        75% {
            background-position-x: calc(var(--s) * -1);
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .walking {
            animation: none;
        }
    }
</style>
