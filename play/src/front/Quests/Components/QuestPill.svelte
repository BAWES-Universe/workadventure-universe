<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { LL } from "../../../i18n/i18n-svelte";
    import type { QuestPath } from "../QuestModel";
    import QuestStamp from "./QuestStamp.svelte";
    import { questControls } from "./questActions";

    /** The followed quest: its badge's glyph is the pill's icon. */
    export let path: QuestPath;
    /** The objective, e.g. "Find the Courtyard". Always shown: the pill is never just its icon. */
    export let label: string;
    /** Done: the glyph pops once, before the payoff takes the pill's place. */
    export let done = false;
    /** "Walk there" is walking the player: a progress line runs along the bottom edge. */
    export let walking = false;
    export let cardId: string;

    const dispatch = createEventDispatcher<{ open: { keyboard: boolean } }>();
    let button: HTMLButtonElement | undefined;

    export function focus(): void {
        button?.focus();
    }
</script>

<!-- One 44px glass capsule with a lavender-to-amber hairline. Its name is the objective plus its state; the glyph and
     the chevron are decoration. -->
<button
    type="button"
    class="quest-pill"
    aria-expanded="false"
    aria-controls={cardId}
    data-testid="quest-pill"
    bind:this={button}
    use:questControls
    on:click={(event) => dispatch("open", { keyboard: event.detail === 0 })}
>
    <span class="quest-pill-glyph" class:quest-pill-pop={done} data-testid="quest-pill-glyph">
        <QuestStamp {path} size={22} glyphOnly tilted={false} />
    </span>
    <span class="quest-pill-label" data-testid="quest-pill-label">{label}</span>
    <span class="sr-only">{done ? $LL.quest.pill.done() : $LL.quest.pill.inProgress()}</span>
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
            d="m6 3.5 4.5 4.5L6 12.5"
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
