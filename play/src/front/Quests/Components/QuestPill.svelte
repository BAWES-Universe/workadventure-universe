<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { LL } from "../../../i18n/i18n-svelte";
    import AchievementIcon from "../../Components/Icons/AchievementIcon.svelte";
    import QuestRing from "./QuestRing.svelte";
    import { questControls } from "./questActions";

    /** The objective, e.g. "Find the Courtyard". Always shown: the pill is never just its icon. */
    export let label: string;
    export let done = false;
    export let cardId: string;

    const dispatch = createEventDispatcher<{ open: { keyboard: boolean } }>();
    let button: HTMLButtonElement | undefined;

    export function focus(): void {
        button?.focus();
    }
</script>

<!-- One 44px line. Its name is the objective plus its state; the ring is decoration. -->
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
    <AchievementIcon height="h-5" width="w-5" strokeColor="stroke-[#c4b5fd]" hover="" classList="shrink-0" />
    <span class="quest-pill-label" data-testid="quest-pill-label">{label}</span>
    <span class="sr-only">{done ? $LL.quest.pill.done() : $LL.quest.pill.inProgress()}</span>
    <QuestRing {done} />
</button>
