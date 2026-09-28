<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { LL } from "../../../i18n/i18n-svelte";
    import type { QuestHost } from "../QuestWorld";
    import QuestHostPortrait from "./QuestHostPortrait.svelte";
    import { questControls } from "./questActions";

    export let host: QuestHost;
    export let eyebrow: string;

    const dispatch = createEventDispatcher<{
        /** `keyboard`: opened with Enter/Space (focus then moves into the options). */
        showOptions: { keyboard: boolean };
        notNow: void;
    }>();

    let showOptionsButton: HTMLButtonElement | undefined;

    /** Gives focus back to "Show me the options" (after the options close). */
    export function focusShowOptions(): void {
        showOptionsButton?.focus();
    }
</script>

<!-- Not a dialog: it takes no focus by itself and the game stays fully usable around it. Escape does nothing here:
     Not now is a choice, not a key. -->
<section
    class="quest-surface @container/quest w-full p-3 pointer-events-auto overflow-y-auto quest-max-h"
    aria-labelledby="quest-invitation-line"
    data-testid="quest-invitation"
    use:questControls
>
    <div class="quest-header">
        <QuestHostPortrait {host} />
        <div class="quest-header-text">
            <p class="quest-eyebrow m-0 truncate" title={eyebrow}>{eyebrow}</p>
            <p id="quest-invitation-line" class="m-0 mt-0.5 text-base font-bold leading-snug">
                {$LL.quest.invitation.line()}
            </p>
            <p class="quest-secondary m-0 mt-0.5">{$LL.quest.invitation.secondary()}</p>
        </div>
    </div>
    <div class="mt-3 flex flex-col gap-2 @[300px]/quest:flex-row">
        <button
            type="button"
            class="quest-btn u-cta flex-1"
            data-testid="quest-show-options"
            bind:this={showOptionsButton}
            on:click={(event) => dispatch("showOptions", { keyboard: event.detail === 0 })}
        >
            {$LL.quest.invitation.showOptions()}
        </button>
        <button
            type="button"
            class="quest-btn quest-ghost flex-1"
            data-testid="quest-not-now"
            on:click={() => dispatch("notNow")}
        >
            {$LL.quest.invitation.notNow()}
        </button>
    </div>
</section>
