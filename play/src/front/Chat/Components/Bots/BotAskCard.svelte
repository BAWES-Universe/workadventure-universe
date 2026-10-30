<script lang="ts">
    import type { BotAsk } from "../../Bots/BotAsk";
    import { IconCheck, IconClock, IconEye } from "@wa-icons";

    /**
     * A bot's card that waits for one person (prototype): an approval before a tool changes, deletes or sends something,
     * or a question before a big job. Options only; typing in the chat box below answers it in your own words.
     */
    export let ask: BotAsk;
    /** Who is looking. Only the person who asked can answer; everyone else sees who it waits for. */
    export let me: string;
    /** The bot's name, for the line that says nothing was done. */
    export let botName: string;

    let showAll = false;

    $: mine = ask.asker === me;
    $: answered = ask.answer?.option ? ask.options.find((option) => option.id === ask.answer?.option) : undefined;
    $: open = !ask.answer;
    $: shownLines = showAll ? ask.lines ?? [] : (ask.lines ?? []).slice(0, 3);
</script>

<div class="ask mx-4 mb-3 flex flex-col" class:answered={!open} data-testid="botAskCard">
    <div class="flex flex-col gap-0.5">
        <b class="ask-title" dir="auto">{ask.title}</b>
        {#if ask.actsAs}
            <span class="ask-acts" dir="auto">Uses {ask.actsAs}{ask.everyTime ? " · asks every time" : ""}</span>
        {/if}
    </div>
    {#if ask.lines?.length && open}
        <div class="ask-lines">
            {#each shownLines as line, i (i)}
                <div dir="auto">{#if line.label}<span class="ask-label">{line.label}</span> {/if}{line.text}</div>
            {/each}
        </div>
        {#if (ask.lines?.length ?? 0) > 3 || ask.kind === "approval"}
            <button type="button" class="ask-more" on:click={() => (showAll = !showAll)}
                >{showAll ? "Show less" : "Show all details"}</button
            >
        {/if}
    {/if}

    {#if open}
        <div class="ask-options" role="group" aria-label={ask.title}>
            {#each ask.options as option (option.id)}
                <button
                    type="button"
                    class="ask-option"
                    class:main={option.main}
                    class:row={ask.kind === "question"}
                    disabled={!mine}
                    data-testid="botAskOption"
                >
                    <span class="ask-option-label">{option.label}</span>
                    {#if option.detail}<span class="ask-option-detail">{option.detail}</span>{/if}
                </button>
            {/each}
        </div>
        <span class="ask-who">
            <IconEye />Only you see this
        </span>
    {:else if answered}
        <span class="ask-done" dir="auto"><IconCheck />You picked <b>{answered.label}</b></span>
    {:else if ask.answer?.typed}
        <span class="ask-who">You typed something else, so nothing was done</span>
    {:else}
        <span class="ask-who"><IconClock />No answer, so {botName} did nothing</span>
    {/if}
</div>

<style>
    /* The same ink and soft violet ring as the reply limit card, and never wider than the message box below (mx-4). */
    .ask {
        gap: 10px;
        padding: 12px;
        border-radius: 16px;
        color: #fff;
        background: linear-gradient(160deg, rgba(31, 28, 47, 0.96), rgba(20, 18, 30, 0.97));
        box-shadow: 0 0 0 1px rgba(167, 139, 250, 0.22), 0 0 24px -12px rgba(134, 41, 252, 0.55);
        overflow-wrap: anywhere;
    }
    .ask.answered {
        gap: 6px;
        box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08);
    }
    .ask-title {
        font-size: 14px;
        line-height: 19px;
    }
    .ask-acts {
        font-size: 12px;
        color: rgba(255, 255, 255, 0.6);
    }
    .ask-lines {
        display: flex;
        flex-direction: column;
        gap: 3px;
        padding: 8px 10px;
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.05);
        font-size: 13px;
        line-height: 18px;
    }
    .ask-label {
        color: rgba(255, 255, 255, 0.55);
    }
    .ask-more {
        align-self: flex-start;
        padding: 0;
        border: 0;
        background: none;
        font-size: 12.5px;
        color: #c4b5fd;
        cursor: pointer;
    }
    .ask-options {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .ask-option {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 44px;
        padding: 6px 16px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.06);
        font-size: 14px;
        font-weight: 700;
        color: #fff;
        cursor: pointer;
        text-align: center;
    }
    .ask-option.row {
        align-items: flex-start;
        border-radius: 14px;
        padding: 8px 14px;
        text-align: start;
    }
    .ask-option.main {
        border: 0;
        background: linear-gradient(90deg, #8629fc, #4156f6);
        box-shadow: 0 8px 24px -10px rgba(134, 41, 252, 0.7);
    }
    .ask-option:disabled {
        opacity: 0.45;
        cursor: default;
    }
    .ask-option-detail {
        font-size: 12px;
        font-weight: 400;
        color: rgba(255, 255, 255, 0.62);
    }
    .ask-option:focus-visible,
    .ask-more:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 2px;
    }
    .ask-who,
    .ask-done {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-size: 12px;
        color: rgba(255, 255, 255, 0.55);
    }
    .ask-done {
        font-size: 13px;
        color: rgba(255, 255, 255, 0.85);
    }
    .ask-who :global(svg),
    .ask-done :global(svg) {
        width: 1.2em;
        height: 1.2em;
        flex: none;
    }
</style>
