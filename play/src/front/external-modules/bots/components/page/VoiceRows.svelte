<script lang="ts">
    // A list of voices to hear and pick (#1668): a radio row with the voice's name and what it is, and a free sample beside it.
    // Tapping a row picks it; saving is the screen's own button. Used by the Voice row (a few voices) and the voice picker (all).
    import LL, { locale } from "../../../../../i18n/i18n-svelte";
    import type { VoiceChoice } from "../../voiceModel";
    import { describeVoice } from "../../voiceModel";
    import { playingSample } from "../../voicePlayer";
    import { IconPauseFilled, IconPlayerPlayFilled } from "@wa-icons";

    export let voices: VoiceChoice[];
    export let pickedId: string | undefined;
    /** A small tag after a voice's name ("Recommended", "Speaking now"), by voice id */
    export let tags: Record<string, string> = {};
    export let onPick: (voice: VoiceChoice) => void;
    export let onPlay: (voice: VoiceChoice) => void;

    $: voice = $LL.mapEditor.edit.bots.page.voice;
</script>

<div class="vp-list" role="radiogroup" aria-label={voice.searchLabel()} data-testid="bot-voice-list">
    {#each voices as choice (choice.voiceId)}
        {@const playing = $playingSample === `row:${choice.voiceId}`}
        <div class="vp-row" class:picked={pickedId === choice.voiceId}>
            <button
                type="button"
                role="radio"
                aria-checked={pickedId === choice.voiceId}
                class="vp-rowpick"
                data-testid="bot-voice-option"
                on:click={() => onPick(choice)}
            >
                <span class="vp-radio" class:on={pickedId === choice.voiceId} aria-hidden="true" />
                <span class="vp-mtx">
                    <span class="vp-vn"
                        >{choice.name}{#if tags[choice.voiceId]}<span class="vp-now">{tags[choice.voiceId]}</span
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

<style>
    .vp-rowpick:focus-visible,
    .vp-play:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 2px;
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
    /* A long description (some voices have nine lines on a phone) would push the next row, and Use, off the screen */
    .vp-cn {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
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
</style>
