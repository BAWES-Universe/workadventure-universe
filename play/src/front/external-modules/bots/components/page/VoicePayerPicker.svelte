<script lang="ts">
    // Where a bot's voice listens and speaks (#1911): first the places that do both jobs (Universe AI, or one lent key whose
    // company listens and speaks), then one row that splits the two jobs, with the reason someone would. Used by the Voice row
    // while voice is off, and by More voice settings › Who pays once it is on. Nothing here is recommended: every place is the
    // same shape, keys by company name.
    import LL from "../../../../../i18n/i18n-svelte";
    import {
        coversBoth,
        optionOf,
        payerOptions,
        sameChoice,
        sourceKey,
        splitChoices,
        type BotVoice,
        type PayerChoice,
        type PayerOption,
        type VoiceKey,
    } from "../../voiceModel";
    import { IconArrowsSplit2, IconInfoCircle, IconKey, IconSparkles, IconChevronDown } from "@wa-icons";

    export let voice: BotVoice;
    /** Where each job runs now (or will, once voice is turned on); null for a job whose key is no longer lent here */
    export let listens: PayerChoice | null;
    export let speaks: PayerChoice | null;
    export let botName: string;
    export let viewerIsMaker: boolean;
    export let maker: string;
    export let saving = false;
    /** "door" or "on": keeps the ids of the two pickers apart */
    export let place: string;
    /** A key as its card names it ("Your ElevenLabs key ••••7c1d") */
    export let keyName: (key: VoiceKey) => string;
    export let onPick: (option: PayerOption) => void;

    $: v = $LL.mapEditor.edit.bots.page.voice;
    $: both = payerOptions(voice).filter(coversBoth);
    $: current = { recognition: listens, speech: speaks };
    // The split lists start open unless one place does both jobs now
    let splitOpen = !(listens && speaks && sameChoice(listens, speaks));

    function pickPart(part: "recognition" | "speech", choice: PayerChoice) {
        const other = part === "speech" ? "recognition" : "speech";
        const pair = (place: PayerChoice) =>
            part === "speech" ? optionOf(voice, place, choice) : optionOf(voice, choice, place);
        // The other job stays where it is; when its place can't do it here any more, it takes the first place that can
        const kept = current[other];
        const next =
            (kept ? pair(kept) : undefined) ??
            splitChoices(voice, other)
                .map(pair)
                .find((option) => option !== undefined);
        if (next) onPick(next);
    }

    // Reactive, so the cards follow listens and speaks when they change
    $: isCurrent = (option: PayerOption) =>
        !!listens && !!speaks && sameChoice(listens, option.recognition) && sameChoice(speaks, option.speech);
</script>

{#if both.length > 0}
    <div class="bp-cap" id="voice-both-{place}">{v.bothCaption()}</div>
    <div class="bp-cards" role="radiogroup" aria-labelledby="voice-both-{place}" data-testid="bot-voice-both">
        {#each both as option (option.id)}
            {@const picked = isCurrent(option)}
            <button
                type="button"
                role="radio"
                class="bp-card"
                class:picked
                aria-checked={picked}
                disabled={saving}
                data-testid="bot-voice-both-{sourceKey(option.speech)}"
                on:click={() => onPick(option)}
            >
                <span class="bp-cico">
                    {#if option.speech.kind === "universe-ai"}<IconSparkles font-size="22" />{:else}<IconKey
                            font-size="22"
                        />{/if}
                </span>
                <span class="bp-ctx">
                    <span class="bp-ct"
                        >{option.speech.kind === "key" ? keyName(option.speech.key) : v.askUniverseAi()}</span
                    >
                    <span class="bp-cn"
                        >{option.speech.kind === "universe-ai"
                            ? v.bothUniverseAiCard()
                            : viewerIsMaker
                            ? v.bothKeyCard()
                            : v.bothKeyCardTheirs({ owner: maker })}</span
                    >
                </span>
                <span class="bp-radio" class:on={picked} aria-hidden="true" />
            </button>
        {/each}
    </div>
{/if}
<button
    type="button"
    class="vg-tap vg-split"
    aria-expanded={splitOpen}
    data-testid="bot-voice-split"
    on:click={() => (splitOpen = !splitOpen)}
>
    <span class="vg-ico"><IconArrowsSplit2 font-size="20" /></span>
    <span class="bp-mtx">
        <span class="vg-t">{v.split()}</span>
        <span class="bp-cn">{v.splitLine()}</span>
    </span>
    <IconChevronDown font-size="18" />
</button>
{#if splitOpen}
    {#each [{ part: "recognition", caption: v.listensWith() }, { part: "speech", caption: v.speaksWith() }] as row (row.part)}
        {@const part = row.part === "speech" ? "speech" : "recognition"}
        <div class="bp-cap" id="voice-{part}-{place}">{row.caption}</div>
        <div
            class="bp-cards"
            role="radiogroup"
            aria-labelledby="voice-{part}-{place}"
            data-testid="bot-voice-split-{part}"
        >
            {#each splitChoices(voice, part) as choice (sourceKey(choice))}
                {@const now = current[part]}
                {@const picked = now !== null && sameChoice(now, choice)}
                <button
                    type="button"
                    role="radio"
                    class="bp-card"
                    class:picked
                    aria-checked={picked}
                    disabled={saving}
                    data-testid="bot-voice-{part}-{sourceKey(choice)}"
                    on:click={() => pickPart(part, choice)}
                >
                    <span class="bp-cico">
                        {#if choice.kind === "universe-ai"}<IconSparkles font-size="22" />{:else}<IconKey
                                font-size="22"
                            />{/if}
                    </span>
                    <span class="bp-ctx">
                        <span class="bp-ct">{choice.kind === "key" ? keyName(choice.key) : v.askUniverseAi()}</span>
                        <span class="bp-cn">
                            {#if choice.kind === "universe-ai"}
                                {part === "speech" ? v.universeAiPeople() : v.universeAiListens()}
                            {:else if viewerIsMaker}
                                {v.keyYouPay()}
                            {:else}
                                {v.keyOwnerPays({ owner: maker })}
                            {/if}
                        </span>
                    </span>
                    <span class="bp-radio" class:on={picked} aria-hidden="true" />
                </button>
            {/each}
        </div>
    {/each}
    <p class="bp-note" data-testid="bot-voice-why-split">
        <IconInfoCircle font-size="14" /><span><b>{v.whySplit()}</b> {v.whySplitLine({ bot: botName })}</span>
    </p>
{/if}

<style>
    .vg-t {
        font-size: 14px;
        font-weight: 600;
    }
    .bp-card:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 2px;
    }
    .vg-tap {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        min-height: 56px;
        margin: 0;
        padding: 6px 4px 6px 8px;
        border: 0;
        border-radius: 14px;
        background: transparent;
        font: inherit;
        color: #fff;
        text-align: start;
        cursor: pointer;
    }
    .vg-tap:disabled {
        cursor: default;
    }
    .vg-tap:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 2px;
    }
    @media (hover: hover) {
        .vg-tap:not(:disabled):hover {
            background: rgba(255, 255, 255, 0.05);
        }
    }
    .vg-tap > :global(svg) {
        flex: none;
        color: rgba(244, 242, 250, 0.64);
    }
    :global([dir="rtl"]) .vg-tap > :global(svg) {
        transform: scaleX(-1);
    }
    .vg-ico {
        display: grid;
        place-items: center;
        flex: none;
        width: 32px;
        height: 32px;
        color: #fff;
    }
    .bp-cap {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(244, 242, 250, 0.64);
    }
    .bp-cards {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    .bp-card {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        min-height: 56px;
        margin: 0;
        padding: 12px;
        border: 0;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.05);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
        font: inherit;
        color: #fff;
        text-align: start;
        cursor: pointer;
    }
    .bp-card.picked {
        background: rgba(134, 41, 252, 0.16);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.7);
    }
    .bp-card:disabled:not(.picked) {
        opacity: 0.55;
        cursor: default;
    }
    .bp-cico {
        flex: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        color: #fff;
    }
    .bp-ctx {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
    }
    .bp-ct {
        font-size: 15px;
        font-weight: 700;
        overflow-wrap: anywhere;
    }
    .bp-cn {
        font-size: 12.5px;
        line-height: 1.35;
        color: rgba(244, 242, 250, 0.64);
    }
    .bp-radio {
        flex: none;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.35);
    }
    .bp-radio.on {
        background: radial-gradient(circle, #fff 0 4px, #6d4aff 5px);
        box-shadow: none;
    }
    .bp-mtx {
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
    }
    .bp-note {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        margin: 0;
        padding: 0 4px;
        font-size: 12.5px;
        line-height: 1.35;
        color: rgba(244, 242, 250, 0.64);
    }
    .bp-note :global(svg) {
        flex: none;
        margin-top: 1px;
    }
    .vg-split > :global(svg) {
        transition: transform 0.15s;
    }
    .vg-split[aria-expanded="true"] > :global(svg) {
        transform: rotate(180deg);
    }
    .bp-note b {
        font-weight: 700;
        color: #fff;
    }
</style>
