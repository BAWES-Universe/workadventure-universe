<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { LL } from "../../../i18n/i18n-svelte";
    import AchievementIcon from "../../Components/Icons/AchievementIcon.svelte";
    import { questControls } from "./questActions";

    /** Quests available here or accepted and not followed: what the log has to offer. */
    export let count = 0;

    const dispatch = createEventDispatcher<{ open: { keyboard: boolean } }>();
    let button: HTMLButtonElement | undefined;

    export function focus(): void {
        button?.focus();
    }
</script>

<!-- The bar never goes empty: with nothing followed, this 44px pill opens the log. -->
<button
    type="button"
    class="quest-pill"
    aria-haspopup="dialog"
    data-testid="quests-pill"
    bind:this={button}
    use:questControls
    on:click={(event) => dispatch("open", { keyboard: event.detail === 0 })}
>
    <AchievementIcon height="h-5" width="w-5" strokeColor="stroke-[#e9c74c]" hover="" classList="shrink-0" />
    <span class="quest-pill-label">{$LL.quest.quests()}</span>
    {#if count > 0}
        <span class="u-count shrink-0" aria-hidden="true">{count}</span>
        <span class="sr-only">{$LL.quest.pill.toDo({ count })}</span>
    {/if}
</button>
