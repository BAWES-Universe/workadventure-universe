<script context="module" lang="ts">
    // Starting one note stops the one playing: two voices at once are never wanted.
    let playingNow: HTMLAudioElement | undefined;
</script>

<script lang="ts">
    import { getContext, hasContext, onDestroy } from "svelte";
    import type { Readable } from "svelte/store";
    import type { ChatMessageContent } from "../../../Connection/ChatConnection";
    import LL from "../../../../../i18n/i18n-svelte";
    import { formatDuration } from "../../../../Components/Broadcast/voiceRecorder";
    import { readAudioShape } from "../../../VoiceNote/AudioShape";
    import {
        isVoiceNoteUnplayed,
        markVoiceNotePlayed,
        resampleWaveform,
        VOICE_NOTE_BARS,
    } from "../../../VoiceNote/VoiceNote";
    import { getMediaCaption } from "../MessageActions/messageActions";
    import { MESSAGE_SENDER_CONTEXT, type MessageSenderInfo } from "./messageSenderContext";
    import { IconPauseFilled, IconPlayFilled } from "@wa-icons";

    export let content: Readable<ChatMessageContent>;

    const sender = hasContext(MESSAGE_SENDER_CONTEXT)
        ? getContext<MessageSenderInfo>(MESSAGE_SENDER_CONTEXT)
        : undefined;
    const isMine = sender?.isMine ?? false;

    const SPEEDS = [1, 1.5, 2];
    const SKIP_SECONDS = 5;

    let player: HTMLAudioElement | undefined;
    // The shape and length: the sender's own when the message carries them, else read from the file.
    let readLevels: number[] | undefined;
    let readDuration: number | undefined;
    let current = 0;
    let playing = false;
    // A note from someone else is new until it is played on this device (their own never is).
    let heard = isMine || !$content.isVoice || !isVoiceNoteUnplayed(sender?.messageId, sender?.sentAt);
    let speed = 0;
    let shapeFor: string | undefined;

    $: isVoice = $content.isVoice === true;
    $: levels = resampleWaveform($content.voiceWaveform ?? readLevels ?? [], VOICE_NOTE_BARS);
    $: duration = $content.voiceDuration ?? readDuration;
    // What a voice note has to say about itself is its shape: an audio file keeps its name above the player.
    $: name = isVoice ? undefined : $content.filename?.trim() || $content.body?.trim() || undefined;
    $: caption = getMediaCaption($content);
    $: needsFile = $content.voiceWaveform === undefined || $content.voiceDuration === undefined;
    $: if ($content.url && needsFile && $content.url !== shapeFor) readShape($content.url);
    $: progress = duration ? Math.min(1, current / duration) : 0;
    $: started = playing || current > 0;

    function readShape(url: string) {
        shapeFor = url;
        readAudioShape(url)
            .then((shape) => {
                if (shapeFor !== url || !shape) return;
                readLevels = shape.levels;
                readDuration = shape.duration;
            })
            .catch((error) => console.warn("voice note shape", error));
    }

    function onPlay() {
        if (playingNow && playingNow !== player) playingNow.pause();
        playingNow = player;
        playing = true;
        if (!heard) {
            heard = true;
            if (sender?.messageId) markVoiceNotePlayed(sender.messageId);
        }
    }

    function toggle() {
        if (!player) return;
        if (playing) player.pause();
        else player.play().catch((error) => console.warn(error));
    }
    function cycleSpeed() {
        speed = (speed + 1) % SPEEDS.length;
        if (player) player.playbackRate = SPEEDS[speed];
    }
    function seekTo(seconds: number) {
        if (!player || !duration) return;
        player.currentTime = Math.min(duration, Math.max(0, seconds));
    }
    function seek(event: MouseEvent) {
        if (!duration) return;
        const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
        seekTo(Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)) * duration);
    }
    function seekByKey(event: KeyboardEvent) {
        if (event.key === "ArrowRight") seekTo(current + SKIP_SECONDS);
        else if (event.key === "ArrowLeft") seekTo(current - SKIP_SECONDS);
        else return;
        event.preventDefault();
    }
    onDestroy(() => {
        player?.pause();
        if (playingNow === player) playingNow = undefined;
    });
</script>

{#if name}
    <div class="px-3 pt-2 text-sm text-white/80 truncate max-w-[260px]">{name}</div>
{/if}
<div class="voice-note" class:mine={isMine} data-testid="voiceNote">
    <button
        type="button"
        class="voice-play"
        on:click={toggle}
        disabled={!$content.url}
        aria-label={playing ? $LL.chat.voiceNote.pause() : $LL.chat.voiceNote.play()}
    >
        {#if playing}
            <IconPauseFilled font-size="18" />
        {:else}
            <IconPlayFilled font-size="18" />
        {/if}
    </button>
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <div
        class="voice-bars"
        on:click={seek}
        on:keydown={seekByKey}
        role="slider"
        aria-label={$LL.chat.voiceNote.position()}
        aria-valuemin={0}
        aria-valuemax={duration ? Math.round(duration) : 0}
        aria-valuenow={Math.round(current)}
        tabindex="0"
    >
        {#each levels as level, index (index)}
            <span
                class:played={index / VOICE_NOTE_BARS < progress}
                style="height: {Math.max(4, Math.round(level * 26))}px"
            />
        {/each}
    </div>
    <div class="voice-time">
        {formatDuration(started ? current : duration ?? 0)}
        {#if !heard}<span class="voice-unheard" role="img" aria-label={$LL.chat.voiceNote.notPlayed()} />{/if}
    </div>
    <!-- Its place is kept, so the bars don't move when it shows. -->
    <button
        type="button"
        class="voice-speed"
        class:voice-speed-hidden={!started}
        on:click={cycleSpeed}
        aria-label={$LL.chat.voiceNote.speed()}
        tabindex={started ? 0 : -1}
    >
        {SPEEDS[speed]}×
    </button>
    {#if $content.url}
        <audio
            src={$content.url}
            preload="metadata"
            bind:this={player}
            bind:currentTime={current}
            on:play={onPlay}
            on:pause={() => (playing = false)}
            on:ended={() => {
                playing = false;
                current = 0;
            }}
            on:loadedmetadata={() => {
                // A browser-made file can have no length in its header: then the player's own length is not used.
                if (player) player.playbackRate = SPEEDS[speed];
            }}
        />
    {/if}
</div>
{#if caption}
    <div class="px-3 pb-2 text-sm text-white/90">{caption}</div>
{/if}

<style>
    .voice-note {
        display: grid;
        grid-template-columns: 44px minmax(0, 1fr) auto;
        grid-template-rows: auto auto;
        column-gap: 10px;
        align-items: center;
        width: 264px;
        max-width: 100%;
        box-sizing: border-box;
        padding: 8px 12px 8px 8px;
    }
    .voice-play {
        grid-row: 1 / span 2;
        width: 44px;
        height: 44px;
        padding: 0;
        border-radius: 9999px;
        display: grid;
        place-items: center;
        color: #fff;
        background: rgba(255, 255, 255, 0.14);
        border: 1px solid rgba(255, 255, 255, 0.16);
        box-sizing: border-box;
        font-family: inherit;
    }
    .voice-bars {
        grid-column: 2;
        grid-row: 1;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        cursor: pointer;
    }
    .voice-bars span {
        flex: none;
        width: 3px;
        border-radius: 9999px;
        background: rgba(255, 255, 255, 0.35);
    }
    .voice-bars span.played {
        background: #fff;
    }
    .voice-time {
        grid-column: 2;
        grid-row: 2;
        font-size: 12px;
        line-height: 16px;
        color: rgba(255, 255, 255, 0.7);
        font-variant-numeric: tabular-nums;
        display: flex;
        align-items: center;
        gap: 6px;
    }
    /* A note that has not been played: the accent, the way Telegram marks one. */
    .voice-unheard {
        width: 7px;
        height: 7px;
        border-radius: 9999px;
        background: #c4b5fd;
    }
    .voice-speed {
        grid-column: 3;
        grid-row: 1 / span 2;
        position: relative;
        min-width: 36px;
        height: 24px;
        padding: 0 8px;
        border-radius: 9999px;
        font-size: 12px;
        font-weight: 700;
        line-height: 1;
        font-family: inherit;
        color: #fff;
        background: rgba(255, 255, 255, 0.14);
        border: 0;
    }
    .voice-speed-hidden {
        visibility: hidden;
    }
    /* A 44px target around the 24px pill. */
    .voice-speed::before {
        content: "";
        position: absolute;
        inset: -10px -4px;
    }
</style>
