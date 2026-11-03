<script lang="ts">
    // The voices to pick from for a bot (#1668): search, a language, and a free sample of each. Tapping a row picks it;
    // only Use saves it. It fills the group in place of the main view, as Mind's model list does.
    import LL, { locale } from "../../../../../i18n/i18n-svelte";
    import type { VoiceChoice } from "../../voiceModel";
    import { describeVoice, filterVoices, languageName, voiceLanguages } from "../../voiceModel";
    import { playingSample } from "../../voicePlayer";
    import PageButton from "./PageButton.svelte";
    import {
        IconCheck,
        IconChevronLeft,
        IconExternalLink,
        IconKey,
        IconPauseFilled,
        IconPlayerPlayFilled,
        IconSearch,
    } from "@wa-icons";

    export let botName: string;
    /** "Voices for Tinyfish on your ElevenLabs key ••••a1b2" */
    export let heading: string;
    /** null while they load */
    export let voices: VoiceChoice[] | null;
    export let failed = false;
    /** The voice the bot speaks with now */
    export let currentId: string | undefined;
    /** Nobody lent a voice key here: the way to more voices is said under the list */
    export let offerKeys = false;
    export let canOpenKeys = false;
    export let busy = false;
    export let onBack: () => void;
    export let onUse: (voice: VoiceChoice) => void;
    export let onPlay: (voice: VoiceChoice) => void;
    export let onRetry: () => void;
    export let onAiKeys: () => void;

    $: voice = $LL.mapEditor.edit.bots.page.voice;

    let query = "";
    let language = "";
    let pickedId: string | undefined = currentId;

    $: languages = voices ? voiceLanguages(voices) : [];
    $: shown = voices ? filterVoices(voices, query, language) : [];
    $: picked = voices?.find((candidate) => candidate.voiceId === pickedId);
</script>

<button type="button" class="vp-back" data-testid="bot-voice-picker-back" on:click={onBack}>
    <IconChevronLeft font-size="18" />{voice.back()}
</button>
<div class="vp-cap2" data-testid="bot-voice-picker-title">{heading}</div>

{#if voices === null && !failed}
    <p class="vp-m">{voice.voicesLoading()}</p>
{:else if failed || voices === null}
    <div class="vp-line">
        <p class="vp-m">{voice.voicesFailed()}</p>
        <PageButton tall on:click={onRetry}>{voice.retry()}</PageButton>
    </div>
{:else}
    <label class="vp-search">
        <IconSearch font-size="18" />
        <input
            type="search"
            bind:value={query}
            placeholder={voice.searchPlaceholder({ count: voices.length })}
            aria-label={voice.searchLabel()}
            data-testid="bot-voice-search"
        />
    </label>
    {#if languages.length > 1}
        <div class="vp-chips" role="radiogroup" aria-label={voice.languageLabel()}>
            {#each ["", ...languages] as code (code)}
                <button
                    type="button"
                    class="vp-chip"
                    class:on={language === code}
                    role="radio"
                    aria-checked={language === code}
                    on:click={() => (language = code)}
                >
                    {#if language === code}<IconCheck font-size="16" />{/if}
                    {code === "" ? voice.anyLanguage() : languageName(code, $locale)}
                </button>
            {/each}
        </div>
    {/if}
    <p class="vp-m">{voice.samplesLine()}</p>
    <div class="vp-list" role="radiogroup" aria-label={voice.searchLabel()} data-testid="bot-voice-list">
        {#each shown as choice (choice.voiceId)}
            {@const playing = $playingSample === `row:${choice.voiceId}`}
            <div class="vp-row" class:picked={pickedId === choice.voiceId}>
                <button
                    type="button"
                    role="radio"
                    aria-checked={pickedId === choice.voiceId}
                    class="vp-rowpick"
                    data-testid="bot-voice-option"
                    on:click={() => (pickedId = choice.voiceId)}
                >
                    <span class="vp-radio" class:on={pickedId === choice.voiceId} aria-hidden="true" />
                    <span class="vp-mtx">
                        <span class="vp-vn"
                            >{choice.name}{#if choice.voiceId === currentId}<span class="vp-now"
                                    >{voice.speakingNow()}</span
                                >{/if}</span
                        >
                        <span class="vp-cn">{describeVoice(choice, $locale)}</span>
                    </span>
                </button>
                <button
                    type="button"
                    class="vp-play"
                    class:on={playing}
                    disabled={!choice.previewUrl}
                    aria-label={choice.previewUrl
                        ? voice.hear({ voice: choice.name })
                        : voice.noSample({ voice: choice.name })}
                    data-testid="bot-voice-option-play"
                    on:click={() => onPlay(choice)}
                >
                    {#if playing}<IconPauseFilled font-size="16" />{:else}<IconPlayerPlayFilled font-size="16" />{/if}
                </button>
            </div>
        {:else}
            <p class="vp-m">{voice.noVoices()}</p>
        {/each}
    </div>
    {#if offerKeys}
        <div class="vp-unlent" data-testid="bot-voice-more-keys">
            <IconKey font-size="18" />
            <div class="vp-mtx">
                <span class="vp-ut">{voice.moreVoicesTitle()}</span>
                <span class="vp-cn">{voice.moreVoicesLine({ bot: botName })}</span>
            </div>
        </div>
        {#if canOpenKeys}
            <div class="vp-line">
                <span />
                <PageButton tall on:click={onAiKeys}>{voice.aiKeys()} <IconExternalLink font-size="14" /></PageButton>
            </div>
        {/if}
    {/if}
    <div class="vp-save">
        <PageButton tall on:click={onBack}>{voice.keep()}</PageButton>
        <PageButton
            tall
            go
            testId="bot-voice-use"
            disabled={busy || !picked || picked.voiceId === currentId}
            on:click={() => picked && onUse(picked)}
        >
            {voice.use({ voice: picked?.name ?? "" }).trim()}
        </PageButton>
    </div>
{/if}

<style>
    .vp-back {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        align-self: flex-start;
        height: 44px;
        margin: -8px 0 -6px -8px;
        padding: 0 8px;
        border: 0;
        border-radius: 999px;
        background: transparent;
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        color: rgba(244, 242, 250, 0.8);
        cursor: pointer;
    }
    :global([dir="rtl"]) .vp-back :global(svg) {
        transform: scaleX(-1);
    }
    .vp-back:focus-visible,
    .vp-chip:focus-visible,
    .vp-play:focus-visible,
    .vp-rowpick:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 2px;
    }
    .vp-cap2 {
        font-size: 15px;
        font-weight: 700;
        overflow-wrap: anywhere;
    }
    .vp-search {
        display: flex;
        align-items: center;
        gap: 8px;
        height: 44px;
        padding: 0 12px;
        border-radius: 999px;
        background: rgba(0, 0, 0, 0.25);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.18);
        color: rgba(244, 242, 250, 0.64);
    }
    .vp-search input {
        flex: 1;
        min-width: 0;
        border: 0;
        background: transparent;
        font: inherit;
        font-size: 14px;
        color: #fff;
        outline: none;
    }
    .vp-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
    }
    .vp-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 44px;
        padding: 0 14px;
        border: 1px solid rgba(243, 241, 250, 0.15);
        border-radius: 999px;
        background: transparent;
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        color: #fff;
        cursor: pointer;
    }
    .vp-chip.on {
        background: rgba(134, 41, 252, 0.16);
        border-color: rgba(167, 139, 250, 0.7);
        font-weight: 700;
    }
    .vp-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    .vp-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 8px 6px 4px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.05);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
    }
    .vp-row.picked {
        background: rgba(134, 41, 252, 0.16);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.7);
    }
    .vp-rowpick {
        display: flex;
        align-items: center;
        gap: 12px;
        flex: 1;
        min-width: 0;
        min-height: 48px;
        margin: 0;
        padding: 4px 8px;
        border: 0;
        background: transparent;
        font: inherit;
        color: #fff;
        text-align: start;
        cursor: pointer;
    }
    .vp-radio {
        flex: none;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.35);
    }
    .vp-radio.on {
        background: radial-gradient(circle, #fff 0 4px, #6d4aff 5px);
        box-shadow: none;
    }
    .vp-mtx {
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
    }
    .vp-vn {
        font-size: 15px;
        font-weight: 700;
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
    }
    .vp-now {
        font-size: 11px;
        font-weight: 700;
        padding: 3px 8px;
        border-radius: 999px;
        border: 1px solid rgba(243, 241, 250, 0.16);
        color: rgba(243, 241, 250, 0.85);
        white-space: nowrap;
    }
    .vp-cn,
    .vp-m {
        margin: 0;
        font-size: 12.5px;
        line-height: 1.35;
        color: rgba(244, 242, 250, 0.64);
    }
    .vp-play {
        flex: none;
        display: grid;
        place-items: center;
        width: 44px;
        height: 44px;
        margin: 0;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.08);
        color: #fff;
        cursor: pointer;
    }
    .vp-play.on {
        background: linear-gradient(135deg, #8629fc, #4156f6);
    }
    .vp-play:disabled {
        opacity: 0.45;
        cursor: default;
    }
    .vp-save {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding-top: 4px;
    }
    .vp-line {
        display: flex;
        align-items: center;
        gap: 10px;
        justify-content: space-between;
    }
    .vp-unlent {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding: 12px;
        border-radius: 14px;
        background: #0a0814;
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
        color: #fff;
    }
    .vp-unlent > :global(svg) {
        flex: none;
        margin-top: 1px;
    }
    .vp-ut {
        font-size: 14px;
        font-weight: 600;
        line-height: 1.35;
        overflow-wrap: anywhere;
    }
</style>
