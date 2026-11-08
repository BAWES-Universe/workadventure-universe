<script lang="ts">
    import { afterUpdate, getContext, hasContext, onDestroy } from "svelte";
    import type { Readable } from "svelte/store";
    import type { ChatMessageContent } from "../../../Connection/ChatConnection";
    import LL from "../../../../../i18n/i18n-svelte";
    import { formatDuration } from "../../../../Components/Broadcast/voiceRecorder";
    import { readAudioShape } from "../../../VoiceNote/AudioShape";
    import { singlePlayback } from "../../../../Utils/SinglePlayback";
    import {
        isVoiceNoteUnplayed,
        markVoiceNotePlayed,
        resampleWaveform,
        VOICE_NOTE_BARS,
    } from "../../../VoiceNote/VoiceNote";
    import { getMediaCaption } from "../MessageActions/messageActions";
    import { saveMessageFiles } from "../MessageActions/availableActions";
    import { fileKindOf, fileNameOfLink } from "../../../../FileViewer/fileKinds";
    import { galleryFileKey } from "../Details/SharedItems";
    import { audioFileKind, audioFileTitle } from "./audioFileTitle";
    import { openSongInPlayer } from "./openSongInPlayer";
    import { MESSAGE_SENDER_CONTEXT, type MessageSenderInfo } from "./messageSenderContext";
    import { IconAlertTriangle, IconDownload, IconMusic, IconPauseFilled, IconPlayFilled } from "@wa-icons";

    export let content: Readable<ChatMessageContent>;
    /** Its place among a gallery message's files: the player knows it by that, not by the message alone. */
    export let galleryPosition: number | undefined = undefined;

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
    // The player's own length, for a file whose shape could not be read (too big, or a format the browser cannot decode).
    let playerDuration: number | undefined;
    let current = 0;
    let playing = false;
    // A note or audio file from someone else is new until it is played on this device (their own never is).
    let heard = isMine || !isVoiceNoteUnplayed(sender?.messageId, sender?.sentAt);
    let speed = 0;
    let shapeFor: string | undefined;
    // An audio file the browser has said it cannot play.
    let playerFailed = false;

    $: isVoice = $content.isVoice === true;
    // What a bot heard in the note, drawn inside its bubble: "Listening…", then two lines of words, or that it could not.
    $: transcript = isVoice ? $content.transcript : undefined;
    let transcriptOpen = false;
    let transcriptOverflows = false;
    let transcriptText: HTMLElement | undefined;
    afterUpdate(() => {
        // Only the folded text can tell whether it was cut: opened, "less" stays.
        if (transcriptText && !transcriptOpen) {
            transcriptOverflows = transcriptText.scrollHeight > transcriptText.clientHeight + 1;
        }
    });
    $: levels = resampleWaveform($content.voiceWaveform ?? readLevels ?? [], VOICE_NOTE_BARS);
    $: duration = $content.voiceDuration ?? readDuration ?? playerDuration;
    // What a voice note has to say about itself is its shape. An audio file shows a title above its shape, and its
    // real name is kept for Download.
    // A song a bot makes can arrive with no name: the link's own name stands in for it, as in the chat's Files list.
    $: fileName = isVoice ? undefined : nameOf($content);
    $: title =
        audioFileTitle(fileName) ??
        (sender?.name ? $LL.chat.audioFile.from({ name: sender.name }) : $LL.chat.audioFile.untitled());
    $: kind = audioFileKind(fileName);
    // An audio file the window can play opens in its player too; a voice note never does (game #1642).
    $: canOpenInPlayer = !isVoice && fileName !== undefined && fileKindOf(fileName) === "audio";
    // A file that could not be fetched has nothing to play or download; one the browser cannot play can still be saved.
    $: unreachable = !isVoice && $content.mediaFailed === true && !$content.url;
    $: failed = !isVoice && (playerFailed || unreachable);
    // Only until the file is here: some phone browsers read nothing of a file before the first tap on play.
    $: loading = !isVoice && !failed && !$content.url;
    $: caption = getMediaCaption($content);
    $: needsFile = $content.voiceWaveform === undefined || $content.voiceDuration === undefined;
    $: if ($content.url && needsFile && $content.url !== shapeFor) readShape($content.url);
    $: progress = duration ? Math.min(1, current / duration) : 0;
    $: started = playing || current > 0;

    /**
     * The file's name: the sender's own, else a body that is an audio file name, else the link's name when it ends
     * as an audio file, else the body as it is.
     */
    function nameOf(message: ChatMessageContent): string | undefined {
        const given = message.filename?.trim();
        if (given) return given;
        const body = message.body?.trim();
        if (body && fileKindOf(body) === "audio") return body;
        if (message.url) {
            const linked = fileNameOfLink(message.url);
            if (fileKindOf(linked) === "audio") return linked;
        }
        return body || undefined;
    }

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
        playing = true;
        if (!heard) {
            heard = true;
            if (sender?.messageId) markVoiceNotePlayed(sender.messageId);
        }
    }

    function download() {
        if (!$content.url) return;
        saveMessageFiles([{ url: $content.url, name: fileName ?? "audio" }]).catch((error) => console.error(error));
    }

    function openInPlayer() {
        if (!$content.url || !fileName) return;
        // The window carries on from here, so the card stops.
        const at = player?.currentTime ?? 0;
        player?.pause();
        openSongInPlayer({
            url: $content.url,
            name: fileName,
            senderName: sender?.name,
            sentByMe: isMine,
            key:
                sender?.messageId === undefined || galleryPosition === undefined
                    ? sender?.messageId
                    : galleryFileKey(sender.messageId, galleryPosition),
            at,
        });
    }

    function toggle() {
        if (!player || failed) return;
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
    // A click or a tap leaves nothing focused on the card: W, A, S, D still walk and no ring shows when they are pressed.
    // Keyboard users Tab to the controls and keep their ring.
    function dropClickFocus(event: MouseEvent) {
        if (event.detail === 0) return;
        const focused = document.activeElement;
        if (focused instanceof HTMLElement && (event.currentTarget as HTMLElement).contains(focused)) focused.blur();
    }
    onDestroy(() => {
        player?.pause();
    });
</script>

<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
<div
    class="voice-note"
    class:audio-file={!isVoice}
    class:mine={isMine}
    class:with-player={canOpenInPlayer && !failed}
    class:with-transcript={transcript !== undefined}
    data-testid={isVoice ? "voiceNote" : "audioFile"}
    on:click={dropClickFocus}
>
    <button
        type="button"
        class="voice-play u-cta-secondary"
        on:click={toggle}
        disabled={!$content.url || loading || failed}
        aria-label={playing ? $LL.chat.voiceNote.pause() : $LL.chat.voiceNote.play()}
    >
        {#if failed}
            <IconAlertTriangle font-size="18" />
        {:else if loading}
            <span class="audio-spinner" />
        {:else if playing}
            <IconPauseFilled font-size="18" />
        {:else}
            <IconPlayFilled font-size="18" />
        {/if}
    </button>
    {#if !isVoice}
        <div class="audio-title" data-testid="audioFileTitle">{title}</div>
    {/if}
    <!-- A file that never arrived has nothing to save: no button that looks tappable and does nothing. -->
    {#if !isVoice && !unreachable}
        <button
            type="button"
            class="audio-download"
            on:click={download}
            disabled={!$content.url}
            aria-label={$LL.chat.audioFile.download()}
            title={$LL.chat.audioFile.download()}
        >
            <IconDownload font-size="18" />
        </button>
    {/if}
    {#if failed}
        <div class="audio-error">{unreachable ? $LL.chat.audioFile.cantLoad() : $LL.chat.audioFile.cantPlay()}</div>
    {:else}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <div
            class="voice-bars"
            class:audio-bars-loading={loading}
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
                    style="height: {loading ? 4 : Math.max(4, Math.round(level * 26))}px"
                />
            {/each}
        </div>
        <div class="voice-time">
            {#if loading}
                {$LL.chat.audioFile.loading()}
            {:else}
                {started
                    ? `${formatDuration(current)} / ${formatDuration(duration ?? 0)}`
                    : formatDuration(duration ?? 0)}
            {/if}
            {#if kind}<span>· {kind}</span>{/if}
            {#if !heard}<span class="voice-unheard" role="img" aria-label={$LL.chat.voiceNote.notPlayed()} />{/if}
        </div>
        <button
            type="button"
            class="voice-speed u-cta-secondary"
            on:click={cycleSpeed}
            disabled={loading}
            aria-label={$LL.chat.voiceNote.speed()}
        >
            {SPEEDS[speed]}×
        </button>
    {/if}
    {#if transcript}
        <div class="transcript transcript-in" class:open={transcriptOpen} data-testid="voiceTranscript">
            {#if transcript.state === "listening"}
                <div class="transcript-status" role="status" data-testid="voiceTranscriptListening">
                    <span class="transcript-dots" aria-hidden="true"><i /><i /><i /></span>
                    {$LL.chat.voiceNote.listening()}
                </div>
            {:else if transcript.state === "failed"}
                <div class="transcript-status" data-testid="voiceTranscriptFailed">
                    <IconAlertTriangle font-size="14" />
                    {$LL.chat.voiceNote.couldntListen()}
                </div>
            {:else}
                <div class="transcript-text" dir="auto" bind:this={transcriptText} data-testid="voiceTranscriptText">
                    {transcript.text}
                </div>
                {#if transcriptOverflows || transcriptOpen}
                    <button
                        type="button"
                        class="transcript-more"
                        aria-expanded={transcriptOpen}
                        data-testid="voiceTranscriptMore"
                        on:click={() => (transcriptOpen = !transcriptOpen)}
                    >
                        {transcriptOpen ? $LL.chat.voiceNote.lessWords() : $LL.chat.voiceNote.moreWords()}
                    </button>
                {/if}
            {/if}
        </div>
    {/if}
    {#if canOpenInPlayer && !failed}
        <button
            type="button"
            class="audio-open-player"
            on:click={openInPlayer}
            disabled={!$content.url}
            data-testid="audioOpenInPlayer"
        >
            <IconMusic font-size="16" />
            {$LL.chat.audioFile.openInPlayer()}
        </button>
    {/if}
    {#if $content.url && !failed}
        <audio
            src={$content.url}
            preload="metadata"
            bind:this={player}
            use:singlePlayback
            bind:currentTime={current}
            on:play={onPlay}
            on:pause={() => (playing = false)}
            on:ended={() => {
                playing = false;
                current = 0;
            }}
            on:loadedmetadata={() => {
                if (player) player.playbackRate = SPEEDS[speed];
            }}
            on:error={() => {
                // The browser cannot play this format (or the file is gone): Download is what is left.
                if (!isVoice) playerFailed = true;
            }}
            on:durationchange={() => {
                // A browser-made file can have no length in its header (the player says Infinity): it is not used then.
                playerDuration =
                    player && Number.isFinite(player.duration) && player.duration > 0 ? player.duration : undefined;
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
        grid-template-areas:
            "play bars speed"
            "play time speed";
        column-gap: 10px;
        align-items: center;
        width: 264px;
        max-width: 100%;
        box-sizing: border-box;
        padding: 8px 12px 8px 8px;
    }
    .voice-play {
        grid-area: play;
        width: 44px;
        height: 44px;
        padding: 0;
        border-radius: 9999px;
        display: grid;
        place-items: center;
        box-sizing: border-box;
        font-family: inherit;
    }
    .voice-bars {
        grid-area: bars;
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
        grid-area: time;
        font-size: 11px;
        line-height: 16px;
        color: rgba(255, 255, 255, 0.5);
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
        grid-area: speed;
        position: relative;
        min-width: 36px;
        height: 24px;
        padding: 0 8px;
        border-radius: 9999px;
        box-sizing: border-box;
        font-size: 11px;
        font-weight: 600;
        line-height: 1;
        font-family: inherit;
    }
    /* A 44px target around the 24px pill. */
    .voice-speed::before {
        content: "";
        position: absolute;
        inset: -10px -4px;
    }
    .voice-speed:disabled {
        opacity: 0.5;
    }

    /* What a bot heard: inside the note's own bubble, with no line and no box, so the note and its words read as one message. */
    .transcript {
        grid-column: 1 / -1;
        margin-top: 8px;
        padding: 0 4px 2px 2px;
        font-size: 13px;
        line-height: 18px;
        color: rgba(255, 255, 255, 0.9);
        text-align: start;
    }
    .transcript-text {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        overflow-wrap: anywhere;
        unicode-bidi: plaintext;
    }
    .transcript.open .transcript-text {
        display: block;
        -webkit-line-clamp: unset;
        line-clamp: unset;
    }
    /* A 44px target with a small word in it. */
    .transcript-more {
        display: inline-block;
        min-height: 44px;
        margin: -6px 0 -10px;
        padding: 6px 12px 6px 0;
        background: none;
        border: 0;
        color: rgba(255, 255, 255, 0.55);
        font-size: 12px;
        font-family: inherit;
        cursor: pointer;
    }
    .transcript-status {
        display: flex;
        align-items: center;
        gap: 8px;
        color: rgba(255, 255, 255, 0.62);
    }
    .transcript-status :global(svg) {
        flex: none;
    }
    .transcript-dots {
        display: inline-flex;
        gap: 3px;
    }
    .transcript-dots i {
        width: 5px;
        height: 5px;
        border-radius: 9999px;
        background: rgba(255, 255, 255, 0.6);
        animation: transcript-dot 1.1s ease-in-out infinite;
    }
    .transcript-dots i:nth-child(2) {
        animation-delay: 0.18s;
    }
    .transcript-dots i:nth-child(3) {
        animation-delay: 0.36s;
    }
    @keyframes transcript-dot {
        0%,
        80%,
        100% {
            opacity: 0.25;
        }
        40% {
            opacity: 1;
        }
    }
    .transcript-in {
        animation: transcript-in 0.35s ease-out;
    }
    @keyframes transcript-in {
        from {
            opacity: 0;
            transform: translateY(-3px);
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .transcript-dots i {
            animation: none;
            opacity: 0.6;
        }
        .transcript-in {
            animation: none;
        }
    }

    /* An audio file: the same player with its title and Download on top, in one piece. */
    .voice-note.audio-file {
        width: 300px;
        grid-template-rows: auto auto auto;
        grid-template-areas:
            "play title download"
            "play bars speed"
            "play time speed";
    }
    /* With "Open in player" along the bottom, the full width of the card. */
    .voice-note.audio-file.with-player {
        grid-template-rows: auto auto auto auto;
        grid-template-areas:
            "play title download"
            "play bars speed"
            "play time speed"
            "open open open";
    }
    .audio-open-player {
        grid-area: open;
        margin: 8px -12px -8px -8px;
        min-height: 44px;
        padding: 0 12px;
        border: 0;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        background: transparent;
        color: #fff;
        font-family: inherit;
        font-size: 13px;
        font-weight: 600;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        cursor: pointer;
    }
    .audio-open-player:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.06);
    }
    .audio-open-player:disabled {
        opacity: 0.5;
        cursor: default;
    }
    .audio-title {
        grid-area: title;
        min-width: 0;
        font-size: 13px;
        line-height: 18px;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.9);
        display: -webkit-box;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        overflow-wrap: anywhere;
    }
    .audio-download {
        grid-area: download;
        justify-self: end;
        align-self: start;
        position: relative;
        width: 36px;
        height: 24px;
        padding: 0;
        border: 0;
        display: grid;
        place-items: center;
        background: transparent;
        color: #fff;
        cursor: pointer;
        font-family: inherit;
    }
    /* A 44px target around the glyph. */
    .audio-download::before {
        content: "";
        position: absolute;
        inset: -10px -4px;
    }
    .audio-bars-loading span {
        background: rgba(255, 255, 255, 0.18);
    }
    .audio-error {
        grid-row: 2 / span 2;
        grid-column: 2 / span 2;
        font-size: 13px;
        line-height: 18px;
        color: rgba(255, 255, 255, 0.7);
    }
    .audio-spinner {
        width: 18px;
        height: 18px;
        border-radius: 9999px;
        border: 2px solid rgba(255, 255, 255, 0.25);
        border-top-color: #fff;
        box-sizing: border-box;
        animation: audio-spin 0.9s linear infinite;
    }
    @keyframes audio-spin {
        to {
            transform: rotate(360deg);
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .audio-spinner {
            animation-duration: 3s;
        }
    }
</style>
