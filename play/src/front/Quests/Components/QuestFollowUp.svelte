<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { LL } from "../../../i18n/i18n-svelte";
    import ButtonClose from "../../Components/Input/ButtonClose.svelte";
    import type { QuestFollowUp } from "../QuestModel";
    import { escapeKey, questKeyboardFocus } from "./questActions";

    export let kind: QuestFollowUp;

    const dispatch = createEventDispatcher<{
        close: void;
        signIn: void;
        tryAnother: { keyboard: boolean };
        backToExploring: void;
    }>();
</script>

<!-- One card after a payoff, never a chain. No timeout: it waits for a choice or the close. -->
<div
    class="quest-surface w-full p-3 pointer-events-auto overflow-y-auto quest-max-h"
    role="dialog"
    aria-modal="false"
    aria-labelledby="quest-follow-up-title"
    data-testid="quest-follow-up"
    use:escapeKey={() => dispatch("close")}
    use:questKeyboardFocus
>
    <div class="flex items-start gap-3">
        <div class="order-last shrink-0">
            <ButtonClose
                size="lg"
                ariaLabel={$LL.quest.close()}
                dataTestId="quest-follow-up-close"
                on:click={() => dispatch("close")}
            />
        </div>
        <h2 id="quest-follow-up-title" class="m-0 min-w-0 flex-1 self-center text-base font-bold leading-snug">
            {kind === "sign-in" ? $LL.quest.followUp.signInTitle() : $LL.quest.options.tryAnother()}
        </h2>
    </div>
    {#if kind === "sign-in"}
        <p class="quest-secondary m-0 mt-1">{$LL.quest.followUp.signInBody()}</p>
        <button
            type="button"
            class="quest-btn u-cta mt-3 w-full"
            data-testid="quest-sign-in"
            on:click={() => dispatch("signIn")}
        >
            {$LL.quest.followUp.signIn()}
        </button>
    {:else}
        <div class="@container/quest mt-3">
            <div class="flex flex-col gap-2 @[300px]/quest:flex-row">
                <button
                    type="button"
                    class="quest-btn u-cta flex-1"
                    data-testid="quest-try-another"
                    on:click={(event) => dispatch("tryAnother", { keyboard: event.detail === 0 })}
                >
                    {$LL.quest.followUp.tryAnother()}
                </button>
                <button
                    type="button"
                    class="quest-btn quest-ghost flex-1"
                    data-testid="quest-back-to-exploring"
                    on:click={() => dispatch("backToExploring")}
                >
                    {$LL.quest.followUp.backToExploring()}
                </button>
            </div>
        </div>
    {/if}
</div>
