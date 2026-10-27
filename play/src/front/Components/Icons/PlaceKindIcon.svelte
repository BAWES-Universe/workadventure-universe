<script lang="ts">
    /**
     * Orbit's place kinds, each in its own colour, as in Orbit and Explore: Tabler's ringed "planet" (MIT) for a
     * universe, Lucide's "earth" for a world and "door-open" for a room (ISC).
     */
    export let kind: "universe" | "world" | "room";
    export let size = 16;
</script>

<svg
    class="place-kind place-kind-{kind}"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
>
    {#if kind === "universe"}
        <path
            d="M18.816 13.58c2.292 2.138 3.546 4 3.092 4.9c-.745 1.46 -5.783 -.259 -11.255 -3.838c-5.47 -3.579 -9.304 -7.664 -8.56 -9.123c.464 -.91 2.926 -.444 5.803 .805"
        />
        <circle cx="12" cy="12" r="7" />
    {:else if kind === "world"}
        <path d="M21.54 15H17a2 2 0 0 0-2 2v4.54" />
        <path d="M7 3.34V5a3 3 0 0 0 3 3a2 2 0 0 1 2 2c0 1.1.9 2 2 2a2 2 0 0 0 2-2c0-1.1.9-2 2-2h3.17" />
        <path d="M11 21.95V18a2 2 0 0 0-2-2a2 2 0 0 1-2-2v-1a2 2 0 0 0-2-2H2.05" />
        <circle cx="12" cy="12" r="10" />
    {:else}
        <path d="M11 20H2" />
        <path d="M11 4.562v16.157a1 1 0 0 0 1.242.97L19 20V5.562a2 2 0 0 0-1.515-1.94l-4-1A2 2 0 0 0 11 4.561z" />
        <path d="M11 4H8a2 2 0 0 0-2 2v14" />
        <path d="M14 12h.01" />
        <path d="M22 20h-3" />
    {/if}
</svg>

<style>
    /* Orbit's --kind-universe-solid, --kind-world-solid and --kind-room-solid */
    .place-kind {
        flex: none;
    }
    .place-kind-universe {
        color: #a78bfa;
    }
    .place-kind-world {
        color: #2dd4bf;
    }
    .place-kind-room {
        color: #fbbf24;
    }
</style>
