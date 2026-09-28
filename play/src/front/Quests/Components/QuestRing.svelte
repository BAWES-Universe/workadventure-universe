<script lang="ts">
    /** The pill's end mark: an empty ring while in progress, a filled ring with a check once done. */
    export let done = false;
    export let size = 20;
</script>

<svg
    class="quest-ring"
    class:done
    width={size}
    height={size}
    viewBox="0 0 20 20"
    fill="none"
    aria-hidden="true"
    focusable="false"
>
    <circle cx="10" cy="10" r="8.25" stroke="#c4b5fd" stroke-width="1.5" />
    {#if done}
        <circle class="fill" cx="10" cy="10" r="8.25" fill="#34d399" fill-opacity=".2" stroke="#34d399" />
        <path class="check" d="m6.5 10.2 2.3 2.3 4.7-4.9" stroke="#34d399" stroke-width="2" stroke-linecap="round" />
    {/if}
</svg>

<style>
    .quest-ring {
        flex: none;
    }
    .fill {
        animation: quest-ring-fill 300ms ease-out both;
    }
    .check {
        stroke-dasharray: 12;
        animation: quest-ring-check 300ms 150ms ease-out both;
    }
    @keyframes quest-ring-fill {
        from {
            opacity: 0;
        }
    }
    @keyframes quest-ring-check {
        from {
            stroke-dashoffset: 12;
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .fill,
        .check {
            animation: none;
        }
    }
</style>
