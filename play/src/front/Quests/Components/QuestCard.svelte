<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { LL } from "../../../i18n/i18n-svelte";
    import ButtonClose from "../../Components/Input/ButtonClose.svelte";
    import type { QuestHost } from "../QuestWorld";
    import QuestHostPortrait from "./QuestHostPortrait.svelte";
    import { escapeKey, questKeyboardFocus } from "./questActions";

    export let id: string;
    export let host: QuestHost;
    export let eyebrow: string;
    /** The objective, e.g. "Find the Courtyard". */
    export let title: string;
    export let body: string;
    /** Where the target is, in words (after Show me). Kept as the card's description so it can be read again. */
    export let showMeDescription: string | undefined = undefined;
    /** The walk control's label ("Walk to the Courtyard", "Walk there"), or undefined when there is nowhere to walk. */
    export let walkLabel: string | undefined = undefined;
    export let walking = false;
    export let canShowMe = true;

    const dispatch = createEventDispatcher<{
        close: void;
        showMe: void;
        walk: void;
        stopWalking: void;
        switch: { keyboard: boolean };
        setAside: void;
    }>();

    let closeWrapper: HTMLElement | undefined;

    export function focusClose(): void {
        closeWrapper?.querySelector("button")?.focus();
    }
</script>

<div
    {id}
    class="quest-surface w-full p-3 pointer-events-auto overflow-y-auto quest-max-h"
    role="dialog"
    aria-modal="false"
    aria-labelledby="{id}-title"
    aria-describedby="{id}-body{showMeDescription ? ` ${id}-where` : ''}"
    data-testid="quest-card"
    use:escapeKey={() => dispatch("close")}
    use:questKeyboardFocus
>
    <div class="flex items-start gap-3">
        <div class="order-last shrink-0" bind:this={closeWrapper}>
            <ButtonClose
                size="lg"
                ariaLabel={$LL.quest.close()}
                dataTestId="quest-card-close"
                on:click={() => dispatch("close")}
            />
        </div>
        <QuestHostPortrait {host} />
        <div class="min-w-0 flex-1">
            <p class="quest-eyebrow m-0 truncate" title={eyebrow}>{eyebrow}</p>
            <h2 id="{id}-title" class="m-0 mt-0.5 text-base font-bold leading-snug">{title}</h2>
        </div>
    </div>
    <p id="{id}-body" class="quest-secondary m-0 mt-2" data-testid="quest-card-body">{body}</p>
    {#if showMeDescription}
        <p id="{id}-where" class="sr-only">{showMeDescription}</p>
    {/if}
    {#if canShowMe}
        <button
            type="button"
            class="quest-btn u-cta mt-3 w-full"
            data-testid="quest-show-me"
            on:click={() => dispatch("showMe")}
        >
            {$LL.quest.card.showMe()}
        </button>
    {/if}
    <div class="quest-text-row mt-1">
        {#if walkLabel}
            {#if walking}
                <button
                    type="button"
                    class="quest-text-btn"
                    data-testid="quest-stop-walking"
                    on:click={() => dispatch("stopWalking")}
                >
                    {$LL.quest.card.stopWalking()}
                </button>
            {:else}
                <button type="button" class="quest-text-btn" data-testid="quest-walk" on:click={() => dispatch("walk")}>
                    {walkLabel}
                </button>
            {/if}
            <span class="quest-dot" aria-hidden="true">·</span>
        {/if}
        <button
            type="button"
            class="quest-text-btn"
            data-testid="quest-switch"
            on:click={(event) => dispatch("switch", { keyboard: event.detail === 0 })}
        >
            {$LL.quest.card.switch()}
        </button>
        <span class="quest-dot" aria-hidden="true">·</span>
        <button
            type="button"
            class="quest-text-btn"
            data-testid="quest-set-aside"
            on:click={() => dispatch("setAside")}
        >
            {$LL.quest.card.setAside()}
        </button>
    </div>
</div>
