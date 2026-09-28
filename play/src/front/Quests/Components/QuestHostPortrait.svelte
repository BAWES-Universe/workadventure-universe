<script lang="ts">
    import Woka from "../../Components/Woka/WokaFromUserId.svelte";
    import type { QuestHost } from "../QuestWorld";

    export let host: QuestHost;
</script>

<!-- The speaker's face at the start of a card: the host bot's real Woka, or for an area the same lavender ring that
     marks it on the map. Decorative: the host's name is the eyebrow next to it. -->
{#if host.kind === "bot"}
    <div
        class="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-white/10 flex items-center justify-center"
        aria-hidden="true"
    >
        {#key host.userId}
            <Woka userId={host.userId} placeholderSrc="" customWidth="2rem" />
        {/key}
    </div>
{:else if host.kind === "area"}
    <div class="h-10 w-10 shrink-0 rounded-lg bg-white/10 flex items-center justify-center" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" focusable="false">
            <ellipse cx="12" cy="14" rx="9" ry="4.5" stroke="#c4b5fd" stroke-width="2" />
            <ellipse cx="12" cy="14" rx="9" ry="4.5" fill="#c4b5fd" fill-opacity=".15" />
        </svg>
    </div>
{/if}
