<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { LL } from "../../../i18n/i18n-svelte";
    import type { QuestPath } from "../QuestModel";
    import QuestStamp from "./QuestStamp.svelte";
    import { questControls } from "./questActions";

    /** The quest on the map, whose badge glyph is the pill's icon; null shows the Quests compass. */
    export let path: QuestPath | null = null;
    /** The objective ("Find the Courtyard"), or "Quests" when nothing is on the map. Always shown. */
    export let label: string;
    /** With nothing on the map: how many quests wait in the panel (available here, or accepted). */
    export let count = 0;
    /** Done: the glyph pops once, before the celebration takes the pill's place. */
    export let done = false;
    /** "Walk there" is walking the player: a progress line runs along the bottom edge. */
    export let walking = false;
    /** The panel is open above the pill: the pill is its handle and closes it. */
    export let open = false;
    export let panelId: string;

    const dispatch = createEventDispatcher<{ toggle: { keyboard: boolean } }>();
    let button: HTMLButtonElement | undefined;

    export function focus(): void {
        button?.focus();
    }
</script>

<!-- The one quest control: a 44px glass capsule with a lavender-to-amber hairline. Tapping it opens the panel above
     it; tapping again closes it. Its name is what it shows plus its state; the glyph and the chevron are decoration. -->
<button
    type="button"
    class="quest-pill"
    class:quest-pill-open={open}
    aria-expanded={open}
    aria-controls={panelId}
    aria-label="{open ? $LL.quest.pill.close() : $LL.quest.pill.open()}: {label}"
    data-testid="quest-pill"
    bind:this={button}
    use:questControls
    on:click={(event) => dispatch("toggle", { keyboard: event.detail === 0 })}
>
    <span class="quest-pill-glyph" class:quest-pill-pop={done} data-testid="quest-pill-glyph">
        {#if path}
            <QuestStamp {path} size={22} glyphOnly tilted={false} />
        {:else}
            <QuestStamp path="explore" size={22} glyphOnly tilted={false} glyphColor="#c4b5fd" />
        {/if}
    </span>
    <span class="quest-pill-label" data-testid="quest-pill-label">{label}</span>
    {#if path}
        <span class="sr-only">{done ? $LL.quest.pill.done() : $LL.quest.pill.inProgress()}</span>
    {:else if count > 0}
        <span class="u-count shrink-0" aria-hidden="true">{count}</span>
        <span class="sr-only">{$LL.quest.pill.toDo({ count })}</span>
    {/if}
    <svg
        class="quest-pill-chevron"
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
        focusable="false"
        data-testid="quest-pill-chevron"
    >
        <path
            d="m3.5 10 4.5-4.5 4.5 4.5"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            stroke-linejoin="round"
        />
    </svg>
    {#if walking}
        <span class="quest-pill-progress" aria-hidden="true" data-testid="quest-pill-progress" />
    {/if}
</button>
