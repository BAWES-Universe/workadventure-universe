<script lang="ts">
    import { onDestroy } from "svelte";
    import { endedAsk, closesSoon, type BotAsk, type BotAskDecision, type BotAskTap } from "../../Bots/BotAsk";
    import LL from "../../../../i18n/i18n-svelte";
    import {
        IconAlertTriangle,
        IconCheck,
        IconChevronDown,
        IconChevronLeft,
        IconChevronRight,
        IconChevronUp,
        IconClock,
        IconLock,
        IconX,
    } from "@wa-icons";

    /**
     * A bot's card that waits for one answer before it changes, deletes or sends something (#1657, mock 3). Pinned above
     * the message box while it waits (docked), then drawn in the chat as it ended. Options only: what the person types
     * in the chat while it waits is their answer instead, and the bot server decides what that means.
     */
    export let ask: BotAsk;
    /** The bot's name, for the lines about what it asks and could not confirm. */
    export let botName: string;
    /** The time now, so the card can say it closes soon or has closed. */
    export let now = Date.now();
    /** Pinned above the message box while it waits, with a close button, instead of sitting in the chat. */
    export let docked = false;
    /** When more than one card waits: which one this is. */
    export let position: { at: number; total: number } | undefined = undefined;
    /** Another waiting card that closes within a minute, so its warning is not hidden behind this one. */
    export let queuedClosingSoon: { at: number; total: number } | undefined = undefined;
    /** A short chat (a phone's half-height sheet): one slim bar; Open raises the sheet to the full card. */
    export let compact = false;
    /** Sends a tap. Resolves false when it could not be sent. */
    export let onTap: (ask: BotAsk, tap: BotAskTap) => Promise<boolean> = () => Promise.resolve(false);
    export let onPrevious: () => void = () => undefined;
    export let onNext: () => void = () => undefined;
    export let onShowQueued: () => void = () => undefined;
    export let onOpen: () => void = () => undefined;

    // A new card, or the same card after the bot server changed it, starts folded and ready for a tap
    let showAll = false;
    let sending = false;
    let failed = false;
    let seen: BotAsk | undefined;
    // A sent tap waits for the bot server's edit of the card. If none comes (the bot is resting, the tap was refused),
    // the card lets the person try again rather than staying shut.
    const EDIT_WAIT_MS = 10_000;
    let editTimer: ReturnType<typeof setTimeout> | undefined;
    onDestroy(() => clearTimeout(editTimer));
    $: if (ask !== seen) {
        seen = ask;
        clearTimeout(editTimer);
        showAll = false;
        sending = false;
        failed = false;
    }

    $: shown = endedAsk(ask, now);
    $: answer = shown.answer;
    $: open = !answer;
    $: soon = open && closesSoon(shown, now);
    // The order a person reads them in: the action first, then allow more, then "don't"
    const ORDER: BotAskDecision[] = ["approve", "approveAndRemember", "decline"];
    $: options = [...shown.options].sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
    $: picked = answer?.option ? shown.options.find((option) => option.id === answer?.option) : undefined;
    // Folded, each line keeps to two lines; there is more to show when there are more than three lines or a long one
    $: expandable = shown.lines.length > 3 || shown.lines.some((line) => line.text.length > 90);
    $: shownLines = showAll ? shown.lines : shown.lines.slice(0, 3);
    $: app = shown.checkAt?.label ?? $LL.chat.botAsk.theApp();

    function tap(action: BotAskTap) {
        if (sending) return;
        sending = true;
        failed = false;
        const tapped = ask;
        onTap(tapped, action)
            .then((sent) => {
                // A sent tap waits for the bot server's edit of the card, which brings a new card in; a failed one can be retried
                if (tapped !== ask) return;
                if (!sent) {
                    sending = false;
                    failed = true;
                    return;
                }
                editTimer = setTimeout(() => {
                    sending = false;
                    failed = true;
                }, EDIT_WAIT_MS);
            })
            .catch(() => {
                sending = false;
                failed = true;
            });
    }
</script>

{#if compact && docked && open}
    <div class="ask ask-bar mx-4 flex items-center" data-testid="botAskBar">
        <div class="flex min-w-0 flex-1 flex-col">
            <span class="ask-from" dir="auto">{$LL.chat.botAsk.needsAnswer({ name: botName })}</span>
            <b class="ask-title truncate" dir="auto">{shown.title}</b>
        </div>
        {#if position && position.total > 1}
            <span class="ask-acts flex-none">{$LL.chat.botAsk.pager({ at: position.at, total: position.total })}</span>
        {/if}
        <button type="button" class="ask-option main ask-open" data-testid="botAskOpen" on:click={onOpen}>
            {$LL.chat.botAsk.open()}
        </button>
    </div>
{:else}
    <div
        class="ask mx-4 mb-3 flex flex-col"
        class:mt-2={!docked}
        class:answered={!open}
        class:docked
        data-testid="botAskCard"
    >
        <div class="ask-head">
            <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                {#if docked}
                    <span class="ask-from" dir="auto">{$LL.chat.botAsk.needsAnswer({ name: botName })}</span>
                {/if}
                <b class="ask-title" dir="auto">{shown.title}</b>
                {#if shown.actsAs || shown.everyTime}
                    <span class="ask-acts" dir="auto" data-testid="botAskActs">
                        {#if shown.actsAs}{$LL.chat.botAsk.usesAccount({ account: shown.actsAs })}{/if}
                        {#if shown.actsAs && shown.everyTime}
                            ·
                        {/if}
                        {#if shown.everyTime}{$LL.chat.botAsk.asksEveryTime({ name: botName })}{/if}
                    </span>
                {/if}
            </div>
            {#if docked && open && position && position.total > 1}
                <div class="ask-pager">
                    <button
                        type="button"
                        class="ask-icon"
                        aria-label={$LL.chat.botAsk.previousCard()}
                        disabled={position.at === 1}
                        data-testid="botAskPrevious"
                        on:click={onPrevious}><IconChevronLeft /></button
                    >
                    <span>{$LL.chat.botAsk.pager({ at: position.at, total: position.total })}</span>
                    <button
                        type="button"
                        class="ask-icon"
                        aria-label={$LL.chat.botAsk.nextCard()}
                        disabled={position.at === position.total}
                        data-testid="botAskNext"
                        on:click={onNext}><IconChevronRight /></button
                    >
                </div>
            {/if}
            {#if docked && open}
                <button
                    type="button"
                    class="ask-icon"
                    aria-label={$LL.chat.botAsk.closeCard()}
                    disabled={sending}
                    data-testid="botAskClose"
                    on:click={() => tap({ action: "close" })}><IconX /></button
                >
            {/if}
        </div>

        {#if shown.lines.length > 0 && open}
            {#if expandable}
                <!-- The whole details box is the tap area: tap anywhere on it to show or hide the rest -->
                <button
                    type="button"
                    class="ask-lines ask-lines-tap"
                    class:clamped={!showAll}
                    aria-expanded={showAll}
                    data-testid="botAskDetails"
                    on:click={() => (showAll = !showAll)}
                >
                    {#each shownLines as line, i (i)}
                        <span class="ask-line" dir="auto"
                            >{#if line.label}<span class="ask-label">{line.label}</span> {/if}{line.text}</span
                        >
                    {/each}
                    <span class="ask-more">
                        {showAll
                            ? $LL.chat.botAsk.showLess()
                            : $LL.chat.botAsk.showAllDetails({ count: shown.lines.length })}
                        {#if showAll}<IconChevronUp />{:else}<IconChevronDown />{/if}
                    </span>
                </button>
            {:else}
                <div class="ask-lines" data-testid="botAskDetails">
                    {#each shownLines as line, i (i)}
                        <span class="ask-line" dir="auto"
                            >{#if line.label}<span class="ask-label">{line.label}</span> {/if}{line.text}</span
                        >
                    {/each}
                </div>
            {/if}
        {/if}

        {#if open}
            <div class="ask-options" role="group" aria-label={shown.title}>
                {#each options as option (option.id)}
                    <button
                        type="button"
                        class="ask-option"
                        class:main={option.id === "approve"}
                        disabled={sending}
                        data-testid="botAskOption"
                        data-option={option.id}
                        on:click={() => tap({ action: "decide", option: option.id })}
                    >
                        {option.label}
                    </button>
                {/each}
            </div>
            {#if queuedClosingSoon}
                <div class="ask-row">
                    <span class="ask-who"
                        ><IconClock />{$LL.chat.botAsk.queuedClosesSoon({
                            at: queuedClosingSoon.at,
                            total: queuedClosingSoon.total,
                        })}</span
                    >
                    <button type="button" class="ask-small" data-testid="botAskShowQueued" on:click={onShowQueued}>
                        {$LL.chat.botAsk.showIt()}
                    </button>
                </div>
            {/if}
            {#if soon}
                <div class="ask-row">
                    <span class="ask-who"><IconClock />{$LL.chat.botAsk.closesSoon()}</span>
                    <button
                        type="button"
                        class="ask-small"
                        disabled={sending}
                        data-testid="botAskMoreTime"
                        on:click={() => tap({ action: "moreTime" })}>{$LL.chat.botAsk.moreTime()}</button
                    >
                </div>
            {/if}
        {:else if picked}
            <span class="ask-done" dir="auto"><IconCheck />{$LL.chat.botAsk.picked({ label: picked.label })}</span>
            {#if answer?.allowedMore}
                <div class="ask-row">
                    <span class="ask-who" dir="auto">{answer.allowedMore}</span>
                    <button
                        type="button"
                        class="ask-small"
                        disabled={sending}
                        data-testid="botAskAskAgain"
                        on:click={() => tap({ action: "askAgain" })}>{$LL.chat.botAsk.askAgain()}</button
                    >
                </div>
            {/if}
            {#if answer?.unknown}
                <span class="ask-warn" dir="auto"
                    ><IconAlertTriangle />{$LL.chat.botAsk.unknownOutcome({
                        app,
                        name: botName,
                        title: shown.title,
                    })}</span
                >
                {#if shown.checkAt}
                    <a class="ask-small" href={shown.checkAt.url} target="_blank" rel="noreferrer noopener">
                        {$LL.chat.botAsk.openApp({ app })}
                    </a>
                {/if}
            {:else if answer?.result}
                <span class="ask-result" dir="auto">{answer.result}</span>
            {/if}
        {:else if answer?.typed}
            <!-- In nearby chat what the person said may have been spoken, so the line doesn't say "typed" -->
            <span class="ask-who" dir="auto"
                >{shown.private ? $LL.chat.botAsk.saidSomethingElse() : $LL.chat.botAsk.typed()}</span
            >
        {:else if answer?.closed}
            <div class="ask-row">
                <span class="ask-who"><IconX />{$LL.chat.botAsk.closed()}</span>
                <button
                    type="button"
                    class="ask-small"
                    disabled={sending}
                    data-testid="botAskReviewAgain"
                    on:click={() => tap({ action: "reviewAgain" })}>{$LL.chat.botAsk.reviewAgain()}</button
                >
            </div>
        {:else}
            <div class="ask-row">
                <span class="ask-who"><IconClock />{$LL.chat.botAsk.expired({ minutes: shown.waitMinutes })}</span>
                <button
                    type="button"
                    class="ask-small"
                    disabled={sending}
                    data-testid="botAskReviewAgain"
                    on:click={() => tap({ action: "reviewAgain" })}>{$LL.chat.botAsk.reviewAgain()}</button
                >
            </div>
        {/if}
        <!-- In nearby chat only the person who asked has this card, and the line says so while it waits (#1658) -->
        {#if shown.private && open}
            <span class="ask-private" data-testid="botAskPrivate"><IconLock />{$LL.chat.botAsk.onlyYouSeeCard()}</span>
        {/if}
        <!-- A tap on an ended card (Review again, Ask me again) can fail too, so this shows in every state -->
        {#if failed}
            <span class="ask-warn" role="status" data-testid="botAskSendFailed"
                ><IconAlertTriangle />{$LL.chat.botAsk.sendFailed()}</span
            >
        {/if}
        {#if shown.notReviewed && open}
            <span class="ask-who" dir="auto" data-testid="botAskNotReviewed"
                ><IconAlertTriangle />{$LL.chat.botAsk.notReviewed({ name: botName })}</span
            >
        {/if}
    </div>
{/if}

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
    /* A tall card scrolls inside itself; its parts never squeeze to fit */
    .ask > :global(*) {
        flex-shrink: 0;
    }
    .ask.docked {
        margin-bottom: 8px;
        max-height: 60vh;
        overflow-y: auto;
        box-shadow: 0 0 0 1px rgba(167, 139, 250, 0.32), 0 -12px 32px -12px rgba(0, 0, 0, 0.6),
            0 0 24px -12px rgba(134, 41, 252, 0.55);
    }
    .ask-bar {
        gap: 10px;
        margin-bottom: 8px;
        padding: 8px 8px 8px 14px;
        box-shadow: 0 0 0 1px rgba(167, 139, 250, 0.32), 0 0 24px -12px rgba(134, 41, 252, 0.55);
    }
    .ask-open {
        flex: none;
        min-width: 88px;
    }
    .ask-head {
        display: flex;
        align-items: flex-start;
        gap: 4px;
    }
    .ask-from {
        font-size: 12px;
        font-weight: 600;
        color: #c4b5fd;
    }
    /* Plain icons, no tile behind them; the tap area is still 44px. */
    .ask-icon {
        display: grid;
        place-items: center;
        flex: none;
        width: 44px;
        height: 44px;
        margin: -10px -10px -10px 0;
        padding: 0;
        border: 0;
        background: none;
        color: rgba(255, 255, 255, 0.7);
        cursor: pointer;
    }
    .ask-icon:disabled {
        opacity: 0.3;
        cursor: default;
    }
    .ask-icon :global(svg) {
        width: 20px;
        height: 20px;
    }
    .ask-pager {
        display: flex;
        align-items: center;
        flex: none;
        margin-right: 6px;
        font-size: 12px;
        color: rgba(255, 255, 255, 0.6);
    }
    .ask-pager .ask-icon {
        width: 36px;
        margin: -10px 0;
    }
    .ask.answered {
        gap: 6px;
        box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08);
    }
    .ask-title {
        font-size: 14px;
        line-height: 19px;
    }
    .ask-private {
        display: flex;
        align-items: center;
        gap: 8px;
        padding-top: 10px;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        color: rgba(255, 255, 255, 0.66);
        font-size: 14px;
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
    /* The details box as one button: at least 44 px tall, the whole box reacts to a tap */
    .ask-lines-tap {
        width: 100%;
        min-height: 44px;
        margin: 0;
        border: 0;
        color: inherit;
        font: inherit;
        font-size: 13px;
        line-height: 18px;
        text-align: start;
        cursor: pointer;
    }
    .ask-lines-tap:hover {
        background: rgba(255, 255, 255, 0.08);
    }
    .ask-line {
        display: block;
    }
    /* Folded: each line keeps to two lines, so a long description never pushes the buttons away */
    .ask-lines-tap.clamped .ask-line {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }
    .ask-more {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        margin-top: 4px;
        padding-top: 6px;
        border-top: 1px solid rgba(255, 255, 255, 0.06);
        font-size: 12.5px;
        color: #c4b5fd;
    }
    .ask-more :global(svg) {
        width: 18px;
        height: 18px;
        flex: none;
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
    .ask-option.main {
        border: 0;
        background: linear-gradient(90deg, #8629fc, #4156f6);
        box-shadow: 0 8px 24px -10px rgba(134, 41, 252, 0.7);
    }
    .ask-option:disabled {
        opacity: 0.45;
        cursor: default;
    }
    .ask-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
    }
    .ask-small {
        align-self: flex-start;
        display: inline-flex;
        align-items: center;
        min-height: 44px;
        padding: 0 16px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.06);
        font-size: 13px;
        font-weight: 700;
        color: #fff;
        text-decoration: none;
        cursor: pointer;
        flex: none;
    }
    .ask-small:disabled {
        opacity: 0.45;
        cursor: default;
    }
    .ask-warn {
        display: inline-flex;
        align-items: flex-start;
        gap: 6px;
        font-size: 13px;
        line-height: 18px;
        color: #fcd34d;
    }
    .ask-result {
        font-size: 13px;
        line-height: 18px;
        color: rgba(255, 255, 255, 0.85);
    }
    .ask-option:focus-visible,
    .ask-small:focus-visible,
    .ask-icon:focus-visible,
    .ask-lines-tap:focus-visible {
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
    .ask-warn :global(svg),
    .ask-done :global(svg) {
        width: 1.2em;
        height: 1.2em;
        flex: none;
    }
</style>
