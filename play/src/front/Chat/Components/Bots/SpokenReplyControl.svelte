<script lang="ts">
    import LL from "../../../../i18n/i18n-svelte";
    import { currentVoiceSpaceStore, resumeBotSound, soundBlockedStore, voiceChoiceStore } from "../../Bots/VoiceBots";
    import { choiceHearsBot } from "../../Bots/VoiceMode";

    /**
     * Round 8: inside a voice bot's reply while people are hearing it, and only for someone whose choice hears bots.
     * Stop speaking stops it for the bubble, as speaking over it would; nothing else changes (listening, the mode, the
     * follow-up window). When the browser blocked the bot's sound, the same place says "Play <bot>'s audio" instead: one
     * tap, which never turns listening on. Once the sound really plays it becomes Stop speaking.
     */
    export let reply: { responseId: string; botSpaceUserId: string };

    $: bot =
        $currentVoiceSpaceStore?.bot?.spaceUserId === reply.botSpaceUserId ? $currentVoiceSpaceStore.bot : undefined;
    $: shown = !!bot && bot.speaking === reply.responseId && choiceHearsBot($voiceChoiceStore);
    $: blocked = $soundBlockedStore.has(reply.botSpaceUserId);
    /** A name kept whole inside a sentence of another direction (an English bot name in Arabic). */
    const isolate = (name: string): string => `⁨${name}⁩`;

    // Called straight from the tap: the browser lets sound start only from a person's own gesture
    function onTap() {
        if (blocked) resumeBotSound(reply.botSpaceUserId);
        else $currentVoiceSpaceStore?.stopSpeaking(reply.botSpaceUserId);
    }
</script>

{#if shown && bot}
    <div class="spoken" data-testid="spokenReply">
        <span class="label">
            <span class="bars" aria-hidden="true"><i /><i /><i /><i /></span>
            <span dir="auto">{$LL.say.voice.listen.speaking()}</span>
        </span>
        <button type="button" class="act" data-testid={blocked ? "spokenReplyPlay" : "spokenReplyStop"} on:click={onTap}
            >{blocked
                ? $LL.say.voice.listen.playAudioOf({ bot: isolate(bot.name) })
                : $LL.say.voice.listen.stopSpeaking()}</button
        >
    </div>
{/if}

<style>
    /* Under the reply's words, inside its bubble, past a thin line */
    .spoken {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 8px 12px;
        margin: 8px 8px 4px;
        padding-top: 10px;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
    }
    .label {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-size: 0.875rem;
        font-weight: 600;
        color: #a78bfa;
    }
    .bars {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        height: 14px;
    }
    .bars i {
        display: block;
        width: 3px;
        height: 100%;
        border-radius: 2px;
        background: currentColor;
        animation: talk 0.9s ease-in-out infinite;
    }
    .bars i:nth-child(1) {
        height: 45%;
        animation-delay: -0.3s;
    }
    .bars i:nth-child(2) {
        animation-delay: -0.6s;
    }
    .bars i:nth-child(3) {
        height: 70%;
    }
    .bars i:nth-child(4) {
        height: 45%;
        animation-delay: -0.45s;
    }
    @keyframes talk {
        50% {
            transform: scaleY(0.55);
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .bars i {
            animation: none;
        }
    }
    /* UI standard secondary button: glass, thin edge, fully round, 44px */
    .act {
        min-height: 44px;
        padding: 0 18px;
        border-radius: 9999px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.06);
        color: #fff;
        font: inherit;
        font-weight: 700;
        font-size: 0.875rem;
        line-height: 1.2;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
    }
    @media (hover: hover) {
        .act:hover {
            background: rgba(255, 255, 255, 0.1);
        }
    }
    .act:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 2px;
    }
</style>
