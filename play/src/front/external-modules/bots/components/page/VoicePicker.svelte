<script lang="ts">
    // The voices to pick from for a bot (#1668): search, a language, and a free sample of each. Tapping a row picks it;
    // only Use saves it. It fills the group in place of the main view, as Mind's model list does.
    import LL, { locale } from "../../../../../i18n/i18n-svelte";
    import type { VoiceChoice } from "../../voiceModel";
    import { filterVoices, languageName, voiceLanguages } from "../../voiceModel";
    import PageButton from "./PageButton.svelte";
    import VoiceRows from "./VoiceRows.svelte";
    import { IconCheck, IconChevronLeft, IconExternalLink, IconKey, IconSearch } from "@wa-icons";

    export let botName: string;
    /** "Voices for Tinyfish on your ElevenLabs key ••••a1b2" */
    export let heading: string;
    /** null while they load */
    export let voices: VoiceChoice[] | null;
    export let failed = false;
    /** The voice the bot speaks with now */
    export let currentId: string | undefined;
    /** The voice picked when it opens, when none is speaking yet (the Voice row's pick) */
    export let startId: string | undefined = undefined;
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
    let pickedId: string | undefined = startId ?? currentId;

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
    <VoiceRows
        voices={shown}
        {pickedId}
        tags={currentId ? { [currentId]: voice.speakingNow() } : {}}
        onPick={(choice) => (pickedId = choice.voiceId)}
        {onPlay}
    />
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
    .vp-chip:focus-visible {
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
    .vp-mtx {
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
    }
    .vp-cn,
    .vp-m {
        margin: 0;
        font-size: 12.5px;
        line-height: 1.35;
        color: rgba(244, 242, 250, 0.64);
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
