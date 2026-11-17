<script lang="ts">
    import { LL } from "../../../i18n/i18n-svelte";
    import { stepMore, tookWords, type BotStep } from "./BotSteps";
    import { IconCheck, IconChevronDown, IconClock, IconHelpCircle, IconMinus, IconX } from "@wa-icons";

    /**
     * One finished call of a bot's steps line (#1723): what it did, in full, with what it was about or why it didn't
     * work under it, and how long it took (#2061). Used for the calls listed while the bot still works and for the list of a
     * folded summary. In a direct message a step that sent something opens in place to say what it sent and got back.
     */
    export let step: BotStep;
    export let iconSize = 15;

    let showing = false;
    $: more = stepMore(step);
    $: opens = !!step.shows?.length;
</script>

<li data-testid="botStepItem">
    {#if step.state === "failed"}
        <IconX class="bot-steps-icon bad" font-size={iconSize} />
    {:else if step.state === "unknown"}
        <IconHelpCircle class="bot-steps-icon" font-size={iconSize} />
    {:else if step.state === "waiting"}
        <IconClock class="bot-steps-icon" font-size={iconSize} />
    {:else if step.state === "running"}
        <!-- Never finished in view: the line stopped (e.g. you walked away) before it said how it went -->
        <IconMinus class="bot-steps-icon" font-size={iconSize} />
    {:else}
        <IconCheck class="bot-steps-icon" font-size={iconSize} />
    {/if}
    <span class="bot-steps-words">
        <span>{step.done}</span>
        {#if more}
            <small>{more}</small>
        {/if}
    </span>
    {#if step.again}
        <em>{$LL.chat.botSteps.again()}</em>
    {/if}
    {#if step.secs !== undefined && step.state !== "waiting"}
        <span class="step-secs" data-testid="botStepSecs">{tookWords(step.secs)}</span>
    {/if}
    {#if opens}
        <button
            type="button"
            class="step-open"
            aria-expanded={showing}
            aria-label={$LL.chat.botSteps.whatItDid()}
            data-testid="botStepOpen"
            on:click={() => (showing = !showing)}
        >
            <IconChevronDown font-size={16} />
        </button>
    {/if}
    {#if showing && step.shows}
        <div class="step-shows" data-testid="botStepShows">
            {#each step.shows as line, index (index)}
                <div>
                    {#if line.label}<span>{line.label}</span>{/if}
                    {line.text}
                </div>
            {/each}
        </div>
    {/if}
</li>

<style lang="scss">
    li {
        flex-wrap: wrap;
    }
    li :global(.bot-steps-words) {
        flex: 1 1 0;
    }
    .step-secs {
        flex: none;
        font-size: 11px;
        font-variant-numeric: tabular-nums;
        color: rgb(255 255 255 / 0.5);
    }
    .step-open {
        all: unset;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        justify-content: center;
        flex: none;
        min-width: 32px;
        min-height: 32px;
        cursor: pointer;
        color: rgb(255 255 255 / 0.6);
        border-radius: 8px;
    }
    .step-open:focus-visible {
        outline: 2px solid #c4b5fd;
        outline-offset: 1px;
    }
    .step-open[aria-expanded="true"] :global(svg) {
        transform: rotate(180deg);
    }
    .step-shows {
        flex-basis: 100%;
        display: grid;
        gap: 3px;
        margin: 0 0 6px 23px;
        padding: 8px 10px;
        border-radius: 10px;
        background: rgb(255 255 255 / 0.06);
        font-size: 12px;
        color: rgb(255 255 255 / 0.85);
        overflow-wrap: anywhere;
    }
    .step-shows span {
        color: rgb(255 255 255 / 0.5);
        margin-right: 4px;
    }
</style>
