<script lang="ts">
    import type { QuestPath } from "../QuestModel";

    export let path: QuestPath;
    /** Rendered size in px. 56 for the payoff, smaller as an icon. */
    export let size = 56;
    export let tilted = true;
</script>

<!-- An ink stamp: a lavender scalloped ring around a gold glyph (butterfly, compass, cube). Decorative: the name is
     always said in text next to it. -->
<svg
    class="quest-stamp"
    class:tilted
    width={size}
    height={size}
    viewBox="0 0 120 120"
    fill="none"
    aria-hidden="true"
    focusable="false"
>
    <g class="ring">
        <path
            d="M60 5 70 11 82 10 89 20 100 24 102 37 111 46 108 59 114 70 105 80 103 93 90 97 82 108 70 107 59 114 48 108 35 109 28 99 16 95 14 82 5 73 9 60 3 48 12 39 14 26 27 22 35 11 48 12Z"
            fill="currentColor"
            fill-opacity=".1"
            stroke="currentColor"
            stroke-width="1.5"
        />
        <circle cx="59" cy="59" r="42" stroke="currentColor" stroke-dasharray="1 4" />
        <circle cx="59" cy="59" r="36" stroke="currentColor" stroke-opacity=".45" />
    </g>
    <g class="glyph">
        {#if path === "meet"}
            <path
                d="M59 62C47 37 31 41 37 55c3 7 14 9 22 7ZM59 62c12-25 28-21 22-7-3 7-14 9-22 7ZM59 62C43 61 38 77 49 77c7 0 8-9 10-15ZM59 62c16-1 21 15 10 15-7 0-8-9-10-15Z"
                fill="currentColor"
            />
            <path d="m55 44 4 8 4-8M59 53v25" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
        {:else if path === "explore"}
            <path d="m72 43-6 23-23 9 10-25 19-7Z" stroke="currentColor" stroke-width="2.5" />
            <path d="m72 43-13 16-16 16 10-25 19-7Z" fill="currentColor" fill-opacity=".7" />
            <circle cx="59" cy="59" r="3" fill="currentColor" />
            <path d="M59 28v5M59 85v5M28 59h5M85 59h5" stroke="currentColor" stroke-width="2" />
        {:else}
            <path d="m59 36 23 13v25L59 87 37 74V49l22-13Z" stroke="currentColor" stroke-width="2.5" />
            <path d="m37 49 22 13 23-13M59 62v25M48 43l22 13v13" stroke="currentColor" stroke-width="2.5" />
        {/if}
        <path d="m24 16 1.8 4.2L30 22l-4.2 1.8L24 28l-1.8-4.2L18 22l4.2-1.8L24 16Z" fill="currentColor" />
    </g>
</svg>

<style>
    .quest-stamp {
        flex: none;
        display: block;
    }
    .quest-stamp.tilted {
        transform: rotate(6deg);
    }
    .ring {
        color: #c4b5fd;
    }
    .glyph {
        color: #e9c74c;
    }
</style>
