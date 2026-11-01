<script lang="ts">
    import { onDestroy } from "svelte";
    import type { Readable } from "svelte/store";
    import { LL } from "../../../i18n/i18n-svelte";
    import { currentStep, stepsClock, type BotSteps } from "./BotSteps";
    import { IconCheck, IconChevronDown, IconChevronUp, IconHelpCircle, IconMinus, IconX } from "@wa-icons";

    /**
     * A bot's steps line (#1545): no bubble, so it never reads as something the bot said. While the bot works it names
     * the step running now, how many are done and a clock. Once it answers it folds into one summary to tap open.
     */
    export let steps: Readable<BotSteps | undefined>;

    let open = false;
    let now = Date.now();
    let clock: ReturnType<typeof setInterval> | undefined;

    $: shown = $steps;
    $: working = shown?.state === "working";
    $: current = shown && working ? currentStep(shown) : undefined;
    $: finished = shown?.steps.filter((step) => step.state !== "running").length ?? 0;
    $: failed = shown?.steps.filter((step) => step.state === "failed").length ?? 0;
    $: unknown = shown?.steps.filter((step) => step.state === "unknown").length ?? 0;
    $: elapsed = shown && shown.startedAt > 0 ? stepsClock((now - shown.startedAt) / 1000) : "";
    $: tick(working);

    function tick(on: boolean) {
        if (on && !clock) {
            now = Date.now();
            clock = setInterval(() => (now = Date.now()), 1000);
        } else if (!on && clock) {
            clearInterval(clock);
            clock = undefined;
        }
    }

    onDestroy(() => clearInterval(clock));
</script>

{#if shown}
    <div class="bot-steps" data-testid="botSteps">
        {#if working}
            <div class="bot-steps-row live" data-testid="botStepsLive" aria-live="polite">
                <svg class="bot-steps-spin" viewBox="0 0 24 24" aria-hidden="true">
                    <defs>
                        <linearGradient id="bot-steps-go" x1="0" y1="0" x2="1" y2="1">
                            <stop offset="0" stop-color="#8629fc" />
                            <stop offset="1" stop-color="#4156f6" />
                        </linearGradient>
                    </defs>
                    <circle cx="12" cy="12" r="8.5" />
                </svg>
                <span class="bot-steps-words">
                    <span class="bot-steps-now">{shown.line}</span>
                    {#if current?.detail}
                        <small>{current.detail}</small>
                    {/if}
                </span>
                <span class="bot-steps-count">
                    {$LL.chat.botSteps.doneCount({ done: finished, total: shown.steps.length })}
                    {#if elapsed}<br />{elapsed}{/if}
                </span>
            </div>
        {:else}
            <button
                class="bot-steps-row"
                aria-expanded={open}
                aria-label={open ? $LL.chat.botSteps.hide() : $LL.chat.botSteps.show()}
                on:click={() => (open = !open)}
                data-testid="botStepsSummary"
            >
                {#if failed > 0 || shown.state === "stopped"}
                    <IconX class="bot-steps-icon bad" font-size={16} />
                {:else if unknown > 0}
                    <IconHelpCircle class="bot-steps-icon" font-size={16} />
                {:else}
                    <IconCheck class="bot-steps-icon" font-size={16} />
                {/if}
                <span class="bot-steps-words">
                    <span
                        >{shown.line}{#if failed > 0}<span>&nbsp;· </span><span class="bad"
                                >{$LL.chat.botSteps.failed({ count: failed })}</span
                            >{/if}{#if unknown > 0}<span>&nbsp;· </span><span class="unknown"
                                >{$LL.chat.botSteps.noAnswer({ count: unknown })}</span
                            >{/if}{#if shown.state === "stopped"}<span>&nbsp;· </span><span class="bad"
                                >{$LL.chat.botSteps.stopped()}</span
                            >{/if}</span
                    >
                </span>
                {#if open}
                    <IconChevronUp class="bot-steps-chevron" font-size={18} />
                {:else}
                    <IconChevronDown class="bot-steps-chevron" font-size={18} />
                {/if}
            </button>
        {/if}
        {#if open && !working && shown.steps.length > 0}
            <ol class="bot-steps-list" data-testid="botStepsList">
                {#each shown.steps as step, index (index)}
                    <li class:bad={step.state === "failed"}>
                        {#if step.state === "failed"}
                            <IconX class="bot-steps-icon bad" font-size={15} />
                        {:else if step.state === "unknown"}
                            <IconHelpCircle class="bot-steps-icon" font-size={15} />
                        {:else if step.state === "running"}
                            <!-- Never finished in view: the line stopped (e.g. you walked away) before it said how it went -->
                            <IconMinus class="bot-steps-icon" font-size={15} />
                        {:else}
                            <IconCheck class="bot-steps-icon" font-size={15} />
                        {/if}
                        <span class="bot-steps-words">
                            <span>{step.done}</span>
                            {#if (step.state === "failed" || step.state === "unknown") && step.note}
                                <small>{step.note}</small>
                            {:else if step.detail}
                                <small>{step.detail}</small>
                            {/if}
                        </span>
                        {#if step.again}
                            <em>{$LL.chat.botSteps.again()}</em>
                        {/if}
                    </li>
                {/each}
            </ol>
        {/if}
    </div>
{/if}

<style lang="scss">
    .bot-steps {
        display: grid;
        min-width: 0;
        max-width: 100%;
        color: rgb(255 255 255 / 0.78);
        font-size: 13px;
    }
    .bot-steps-row {
        all: unset;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 44px;
        padding: 4px 6px;
        min-width: 0;
        max-width: 100%;
        cursor: pointer;
        border-radius: 8px;
    }
    button.bot-steps-row:focus-visible {
        outline: 2px solid #c4b5fd;
        outline-offset: 1px;
    }
    .bot-steps-row.live {
        cursor: default;
    }
    .bot-steps-words {
        display: grid;
        min-width: 0;
        line-height: 1.35;
    }
    .bot-steps-words small {
        font-size: 12px;
        color: rgb(255 255 255 / 0.5);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .bot-steps-now {
        color: white;
        font-weight: 600;
    }
    .bot-steps-count {
        margin-left: auto;
        flex: none;
        font-size: 11px;
        line-height: 1.35;
        text-align: right;
        color: rgb(255 255 255 / 0.5);
        font-variant-numeric: tabular-nums;
    }
    .bot-steps :global(.bot-steps-icon) {
        flex: none;
        color: rgb(255 255 255 / 0.7);
    }
    .bot-steps :global(.bot-steps-chevron) {
        flex: none;
        color: rgb(255 255 255 / 0.6);
    }
    /* The game's coral, the colour it uses for ending and for what went wrong */
    .bad,
    .bot-steps :global(.bot-steps-icon.bad) {
        color: #e96d51;
    }
    /* A call that may have run (#1692): not a failure, so not the coral */
    .bot-steps-words .unknown {
        white-space: nowrap;
        color: white;
    }
    .bot-steps-words .bad {
        white-space: nowrap;
    }
    .bot-steps-spin {
        flex: none;
        width: 16px;
        height: 16px;
        fill: none;
        stroke: url(#bot-steps-go);
        stroke-width: 3;
        stroke-linecap: round;
        stroke-dasharray: 36 60;
        animation: bot-steps-spin 1s linear infinite;
    }
    @keyframes bot-steps-spin {
        to {
            transform: rotate(360deg);
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .bot-steps-spin {
            animation: none;
        }
    }
    .bot-steps-list {
        list-style: none;
        margin: 0 0 4px 13px;
        padding: 2px 0 2px 14px;
        border-left: 1px solid rgb(255 255 255 / 0.12);
        display: grid;
        gap: 2px;
        min-width: 0;
    }
    .bot-steps-list li {
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 40px;
        min-width: 0;
        color: rgb(255 255 255 / 0.85);
    }
    .bot-steps-list em {
        margin-left: auto;
        flex: none;
        font-style: normal;
        font-size: 11px;
        color: #c4b5fd;
    }
</style>
