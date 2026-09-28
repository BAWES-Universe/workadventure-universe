<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { LL } from "../../../i18n/i18n-svelte";
    import type { QuestPath } from "../QuestModel";
    import { QUEST_PATHS } from "../QuestModel";
    import QuestStamp from "./QuestStamp.svelte";
    import { escapeKey, questControls } from "./questActions";

    /** A quest, or the whole chapter (every quest done). */
    export let kind: "quest" | "chapter";
    export let path: QuestPath | null = null;
    /** Who is speaking (the giver frozen at acceptance). */
    export let eyebrow = "";
    /** The giver's line ("Good to meet you."), or the chapter's. */
    export let line: string;
    /** "First Hello badge earned". */
    export let badgeLine: string;
    /** The badge's name, for the stamp's label. */
    export let stampLabel = "";

    const dispatch = createEventDispatcher<{ skip: void }>();
</script>

<!-- Three seconds in the corner, in step with the burst at the player's feet: the badge stamps itself in, the
     giver has the last word, then the panel takes over by itself. Tapping it (or Escape) skips ahead. -->
<button
    type="button"
    class="quest-surface quest-celebration pointer-events-auto"
    class:quest-celebration-chapter={kind === "chapter"}
    data-testid="quest-celebration"
    data-kind={kind}
    use:escapeKey={() => dispatch("skip")}
    use:questControls
    on:click={() => dispatch("skip")}
>
    <span class="quest-celebration-shine" aria-hidden="true" />
    {#if kind === "quest" && path}
        <span class="quest-celebration-stamp" role="img" aria-label={stampLabel}>
            <QuestStamp {path} size={64} />
        </span>
        <span class="min-w-0 flex-1 text-start">
            <span class="quest-celebration-title block" data-testid="quest-celebration-title">
                {$LL.quest.celebration.questComplete()}
            </span>
            {#if eyebrow}
                <span class="quest-eyebrow block truncate" title={eyebrow}>{eyebrow}</span>
            {/if}
            <span class="block text-base font-bold leading-snug">{line}</span>
            <span class="quest-badge-line block" data-testid="quest-celebration-badge">{badgeLine}</span>
        </span>
    {:else}
        <span class="flex w-full flex-col items-center gap-2 text-center">
            <span class="quest-celebration-title block" data-testid="quest-celebration-title">
                {$LL.quest.celebration.chapterTitle()}
            </span>
            <span class="flex items-center justify-center gap-2" role="img" aria-label={badgeLine}>
                {#each QUEST_PATHS as stampPath, index (stampPath)}
                    <span class="quest-celebration-stamp" style="animation-delay: {index * 140}ms">
                        <QuestStamp path={stampPath} size={56} tilted={index % 2 === 0} />
                    </span>
                {/each}
            </span>
            <span class="block text-base font-bold leading-snug">{line}</span>
        </span>
    {/if}
</button>
