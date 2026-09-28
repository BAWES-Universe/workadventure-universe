<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { LL } from "../../../i18n/i18n-svelte";
    import AchievementIcon from "../../Components/Icons/AchievementIcon.svelte";
    import QuestRing from "./QuestRing.svelte";

    /** The objective, e.g. "Find the Courtyard". */
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
    on:click={(event) => dispatch("open", { keyboard: event.detail === 0 })}
>
    <AchievementIcon height="h-5" width="w-5" strokeColor="stroke-[#c4b5fd]" hover="" classList="shrink-0" />
    <span class="min-w-0 truncate">{label}</span>
    <span class="sr-only">{done ? $LL.quest.pill.done() : $LL.quest.pill.inProgress()}</span>
    <QuestRing {done} />
</button>
