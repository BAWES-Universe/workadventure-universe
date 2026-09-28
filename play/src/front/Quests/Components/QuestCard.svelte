<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { LL } from "../../../i18n/i18n-svelte";
    import ButtonClose from "../../Components/Input/ButtonClose.svelte";
    import type { QuestHost } from "../QuestWorld";
    import QuestHostPortrait from "./QuestHostPortrait.svelte";
    import { escapeKey, questControls, questKeyboardFocus } from "./questActions";

    export let id: string;
    export let host: QuestHost;
    export let eyebrow: string;
    /** The objective, e.g. "Find the Courtyard". */
    export let title: string;
    export let body: string;
    /** Where the target is, in words (announced when the card opens). Kept as the card's description. */
    export let whereDescription: string | undefined = undefined;
    /** The walk control's label ("Walk to the Courtyard", "Walk there"), or undefined when there is nowhere to walk. */
    export let walkLabel: string | undefined = undefined;
    export let walking = false;
    /** Finished, its payoff waiting for a quiet moment: nothing left to find or walk to. */
    export let done = false;

    const dispatch = createEventDispatcher<{
        close: void;
        walk: void;
        stopWalking: void;
        chooseAnother: { keyboard: boolean };
        /** The person is reading or using the card (focus inside, the pointer over it): it must not fold by itself. */
        engage: void;
    }>();

    let closeWrapper: HTMLElement | undefined;
    let walkButton: HTMLButtonElement | undefined;
    let chooseButton: HTMLButtonElement | undefined;

    export function focusClose(): void {
        closeWrapper?.querySelector("button")?.focus();
    }

    $: showWalk = !!walkLabel && !done;
    $: keepFocusInCard(showWalk);
    // The walk control is about to go (arrived, no path, done) while it has focus: focus stays in the card.
    function keepFocusInCard(walkShown: boolean) {
        const active = document.activeElement;
        if (!active || active !== walkButton || walkShown) return;
        if (chooseButton) chooseButton.focus();
        else focusClose();
    }
</script>

<div
    {id}
    class="quest-surface @container/quest w-full p-3 pointer-events-auto overflow-y-auto quest-max-h"
    role="dialog"
    aria-modal="false"
    aria-labelledby="{id}-title"
    aria-describedby="{id}-body{whereDescription ? ` ${id}-where` : ''}"
    data-testid="quest-card"
    use:escapeKey={() => dispatch("close")}
    use:questKeyboardFocus
    use:questControls
    on:focusin={() => dispatch("engage")}
    on:pointerenter={() => dispatch("engage")}
    on:pointerdown={() => dispatch("engage")}
>
    <div class="quest-header">
        <div class="quest-header-close" bind:this={closeWrapper}>
            <ButtonClose
                size="lg"
                ariaLabel={$LL.quest.close()}
                dataTestId="quest-card-close"
                on:click={() => dispatch("close")}
            />
        </div>
        <QuestHostPortrait {host} />
        <div class="quest-header-text">
            <p class="quest-eyebrow m-0 truncate" title={eyebrow}>{eyebrow}</p>
            <h2 id="{id}-title" class="m-0 mt-0.5 text-base font-bold leading-snug">{title}</h2>
        </div>
    </div>
    <p id="{id}-body" class="quest-secondary m-0 mt-2" data-testid="quest-card-body">{body}</p>
    {#if whereDescription}
        <p id="{id}-where" class="sr-only">{whereDescription}</p>
    {/if}
    <!-- Real buttons, never links: the walk (when there is somewhere to walk) is the one primary action. -->
    <div class="mt-3 flex flex-col gap-2 @[300px]/quest:flex-row">
        {#if showWalk}
            <!-- One button whose label switches, so pressing it from the keyboard keeps focus on it. -->
            <button
                type="button"
                class="quest-btn u-cta flex-1"
                data-testid={walking ? "quest-stop-walking" : "quest-walk"}
                bind:this={walkButton}
                on:click={() => dispatch(walking ? "stopWalking" : "walk")}
            >
                {walking ? $LL.quest.card.stopWalking() : walkLabel}
            </button>
        {/if}
        <button
            type="button"
            class="quest-btn quest-ghost flex-1"
            data-testid="quest-choose-another"
            bind:this={chooseButton}
            on:click={(event) => dispatch("chooseAnother", { keyboard: event.detail === 0 })}
        >
            {$LL.quest.card.chooseAnother()}
        </button>
    </div>
</div>
