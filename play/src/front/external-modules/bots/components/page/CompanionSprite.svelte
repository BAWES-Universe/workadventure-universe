<script lang="ts">
    /**
     * One frame of a companion's 3 × 4 sprite sheet (32px frames), drawn crisp at any size. Rows are the
     * directions (0 down, 1 left, 2 right, 3 up); the middle column is the standing frame. Walking plays the
     * columns 0, 1, 2, 1 in turn, on the spot.
     */
    export let url: string;
    export let size = 64;
    export let row = 0;
    export let walking = false;

    $: cssUrl = 'url("' + url.replace(/["\\\n]/g, (c) => "\\" + c) + '")';
</script>

<span
    class="companion-sprite"
    class:walking
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
    .walking {
        animation: companion-walk 720ms steps(1) infinite;
    }
    @keyframes companion-walk {
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
