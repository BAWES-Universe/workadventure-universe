<script lang="ts">
    import Woka from "../../Components/Woka/WokaFromUserId.svelte";
    import type { QuestHost } from "../QuestWorld";

    export let host: QuestHost;
    /** Rendered size: the card's 2.5rem square, or the panel row's 2.25rem. */
    export let size: "md" | "sm" = "md";
    $: box = size === "sm" ? "h-9 w-9" : "h-10 w-10";
    $: woka = size === "sm" ? "1.75rem" : "2rem";
</script>

<!-- The speaker's face at the start of a card: the host bot's live Woka when it is near, the face frozen with the
     quest when it is not, or for an area the same lavender ring that marks it on the map. Decorative: the host's
     name is the eyebrow next to it. -->
{#if host.kind === "bot"}
    <div
        class="{box} shrink-0 overflow-hidden rounded-lg bg-white/10 flex items-center justify-center"
        aria-hidden="true"
        data-testid="quest-portrait"
    >
        {#if host.userId !== null}
            {#key host.userId}
                <Woka userId={host.userId} placeholderSrc={host.portrait ?? ""} customWidth={woka} />
            {/key}
        {:else if host.portrait}
            <img src={host.portrait} alt="" style="width: {woka}; image-rendering: pixelated;" />
        {/if}
    </div>
{:else if host.kind === "area"}
    <div class="{box} shrink-0 rounded-lg bg-white/10 flex items-center justify-center" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" focusable="false">
            <ellipse cx="12" cy="14" rx="9" ry="4.5" stroke="#c4b5fd" stroke-width="2" />
            <ellipse cx="12" cy="14" rx="9" ry="4.5" fill="#c4b5fd" fill-opacity=".15" />
        </svg>
    </div>
{/if}
