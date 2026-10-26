<script lang="ts">
    import { onDestroy } from "svelte";
    import LL from "../../../../../i18n/i18n-svelte";
    import WaveBars from "../../../../Components/Broadcast/WaveBars.svelte";
    import { formatDuration } from "../../../../Components/Broadcast/voiceRecorder";
    import {
        browserRecordingFormat,
        resampleWaveform,
        VOICE_NOTE_BARS,
        VOICE_NOTE_MAX_SECONDS,
        VOICE_NOTE_WARNING_SECONDS,
        type VoiceNoteDetails,
    } from "../../../VoiceNote/VoiceNote";
    import { startVoiceNoteRecording, type VoiceNoteRecording } from "../../../VoiceNote/VoiceNoteRecorder";
    import { IconMicrophoneOn, IconPauseFilled, IconPlayFilled, IconSend, IconTrash } from "@wa-icons";

    /** Whether the mic shows when nothing is being recorded: the box is empty and files can be sent here. */
    export let canRecord = false;
    /** Sends the note and says whether it went. When it did not, the note stays here to be sent again. */
    export let onSend: (file: File, details: VoiceNoteDetails) => Promise<boolean>;
    /** Says why recording could not start (the microphone is blocked or missing). */
    export let onError: (message: string) => void;
    /** True from the first tap on the mic until the note is sent or deleted: the message box gives way to this. */
    export let active = false;

    type State = "idle" | "recording" | "review";
    let state: State = "idle";
    $: active = state !== "idle";

    const format = browserRecordingFormat();
    const LIVE_BARS = 28;

    let recording: VoiceNoteRecording | undefined;
    let starting = false;
    let sending = false;
    let seconds = 0;
    let startedAt = 0;
    let timer: ReturnType<typeof setInterval> | undefined;
    let live: number[] = new Array<number>(LIVE_BARS).fill(0);

    let note: { file: File; details: VoiceNoteDetails; url: string; shape: number[] } | undefined;
    let player: HTMLAudioElement | undefined;
    let playing = false;
    let current = 0;

    $: left = Math.ceil(VOICE_NOTE_MAX_SECONDS - seconds);
    $: progress = note && note.details.duration > 0 ? Math.min(1, current / note.details.duration) : 0;

    function errorMessage(error: unknown): string {
        const name = error instanceof DOMException ? error.name : "";
        if (name === "NotAllowedError" || name === "SecurityError") return $LL.chat.voiceNote.micBlocked();
        if (name === "NotFoundError" || name === "OverconstrainedError") return $LL.chat.voiceNote.micMissing();
        return $LL.chat.voiceNote.recordingFailed();
    }

    async function start() {
        if (!format || starting || state !== "idle") return;
        starting = true;
        try {
            recording = await startVoiceNoteRecording(format);
        } catch (error) {
            console.warn("Could not start a voice note", error);
            onError(errorMessage(error));
            return;
        } finally {
            // eslint-disable-next-line require-atomic-updates
            starting = false;
        }
        // eslint-disable-next-line require-atomic-updates
        state = "recording";
        startedAt = Date.now();
        seconds = 0;
        live = new Array<number>(LIVE_BARS).fill(0);
        timer = setInterval(() => {
            seconds = (Date.now() - startedAt) / 1000;
            live = [...live.slice(1), recording?.level() ?? 0];
            // At the cap it stops by itself and waits for Send.
            if (seconds >= VOICE_NOTE_MAX_SECONDS) stop().catch((error) => console.error(error));
        }, 100);
    }

    async function stop() {
        clearInterval(timer);
        const finishing = recording;
        recording = undefined;
        if (!finishing) return;
        try {
            const done = await finishing.stop();
            note = {
                ...done,
                url: URL.createObjectURL(done.file),
                shape: resampleWaveform(done.details.waveform, VOICE_NOTE_BARS),
            };
            seconds = done.details.duration;
            state = "review";
        } catch (error) {
            console.error(error);
            discard();
            onError($LL.chat.voiceNote.recordingFailed());
        }
    }

    function discard() {
        clearInterval(timer);
        recording?.cancel();
        recording = undefined;
        player?.pause();
        if (note) URL.revokeObjectURL(note.url);
        note = undefined;
        playing = false;
        current = 0;
        seconds = 0;
        state = "idle";
    }

    async function send() {
        if (sending) return;
        // Send while recording stops it first: what was said so far goes.
        if (state === "recording") await stop();
        if (!note) return;
        // eslint-disable-next-line require-atomic-updates
        sending = true;
        player?.pause();
        let sent = false;
        try {
            sent = await onSend(note.file, note.details);
        } catch (error) {
            console.error(error);
        } finally {
            // eslint-disable-next-line require-atomic-updates
            sending = false;
        }
        if (sent) discard();
    }

    function togglePlay() {
        if (!player) return;
        if (playing) player.pause();
        else player.play().catch((error) => console.warn(error));
    }

    onDestroy(() => {
        // Leaving the chat lets the microphone go.
        discard();
    });
</script>

{#if state === "idle"}
    {#if canRecord && format}
        <button
            type="button"
            class="voice-record text-white"
            data-testid="voiceRecordButton"
            aria-label={$LL.chat.voiceNote.record()}
            title={$LL.chat.voiceNote.record()}
            on:click={() => start().catch((error) => console.error(error))}
        >
            <IconMicrophoneOn font-size={20} />
        </button>
    {/if}
{:else}
    <button
        type="button"
        class="voice-button text-white"
        data-testid="voiceDeleteButton"
        aria-label={$LL.chat.voiceNote.delete()}
        disabled={sending}
        on:click={discard}
    >
        <IconTrash font-size={20} />
    </button>
    {#if state === "recording"}
        <div class="voice-live" data-testid="voiceRecording">
            <span class="voice-rec-dot" aria-hidden="true" />
            <span class="voice-clock" class:voice-ending={left <= VOICE_NOTE_WARNING_SECONDS}>
                {formatDuration(seconds)}{#if left <= VOICE_NOTE_WARNING_SECONDS}<span class="voice-left"
                        >&nbsp;· {$LL.chat.voiceNote.secondsLeft({ seconds: left })}</span
                    >{/if}
            </span>
            <WaveBars
                levels={live}
                height={26}
                gap={2}
                barWidth={3}
                classList="flex-1 min-w-0 overflow-hidden justify-end"
            />
        </div>
        <button
            type="button"
            class="voice-button voice-stop"
            data-testid="voiceStopButton"
            aria-label={$LL.chat.voiceNote.stopAndListen()}
            on:click={() => stop()}
        >
            <span class="voice-stop-square" aria-hidden="true" />
        </button>
    {:else if note}
        <div class="voice-live" data-testid="voiceReview">
            <button
                type="button"
                class="voice-review-play"
                aria-label={playing ? $LL.chat.voiceNote.pause() : $LL.chat.voiceNote.listen()}
                on:click={togglePlay}
            >
                {#if playing}<IconPauseFilled font-size="16" />{:else}<IconPlayFilled font-size="16" />{/if}
            </button>
            <div class="voice-review-bars" aria-hidden="true">
                {#each note.shape as level, index (index)}
                    <span
                        class:played={index / note.shape.length < progress}
                        style="height: {Math.max(4, Math.round(level * 24))}px"
                    />
                {/each}
            </div>
            <span class="voice-clock">
                {formatDuration(playing || current > 0 ? current : note.details.duration)}
            </span>
            <audio
                src={note.url}
                bind:this={player}
                bind:currentTime={current}
                on:play={() => (playing = true)}
                on:pause={() => (playing = false)}
                on:ended={() => {
                    playing = false;
                    current = 0;
                }}
            />
        </div>
    {/if}
    <button
        type="button"
        class="voice-button voice-send text-white disabled:opacity-30"
        data-testid="voiceSendButton"
        aria-label={$LL.chat.voiceNote.send()}
        disabled={sending || starting}
        on:click={() => send()}
    >
        <IconSend />
    </button>
{/if}

<style>
    .voice-record,
    .voice-button {
        width: 40px;
        height: 40px;
        padding: 0;
        border-radius: 9999px;
        display: grid;
        place-items: center;
        flex: none;
    }
    .voice-record:hover {
        background: rgba(255, 255, 255, 0.1);
    }
    /* Send is the one filled button: the brand gradient, as in the message box. */
    .voice-send {
        background: linear-gradient(135deg, #8629fc, #4156f6);
    }
    .voice-stop {
        border: 1px solid rgba(255, 255, 255, 0.16);
        background: rgba(255, 255, 255, 0.08);
        box-sizing: border-box;
        margin-right: 4px;
    }
    .voice-stop-square {
        width: 14px;
        height: 14px;
        border-radius: 3px;
        background: #fff;
    }
    .voice-live {
        flex: 1;
        min-width: 0;
        height: 52px;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 0 6px;
    }
    .voice-rec-dot {
        flex: none;
        width: 10px;
        height: 10px;
        border-radius: 9999px;
        background: #e96d51;
        box-shadow: 0 0 0 4px rgba(233, 109, 81, 0.25);
        animation: voice-pulse 1.2s ease-in-out infinite;
    }
    @keyframes voice-pulse {
        50% {
            opacity: 0.7;
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .voice-rec-dot {
            animation: none;
        }
    }
    .voice-clock {
        flex: none;
        font-size: 15px;
        font-weight: 600;
        color: #fff;
        font-variant-numeric: tabular-nums;
    }
    /* The last seconds: amber, with how many are left. */
    .voice-ending {
        color: #fbbf24;
    }
    .voice-left {
        font-weight: 400;
    }
    .voice-review-play {
        flex: none;
        width: 36px;
        height: 36px;
        padding: 0;
        border-radius: 9999px;
        display: grid;
        place-items: center;
        color: #fff;
        background: rgba(255, 255, 255, 0.14);
        border: 1px solid rgba(255, 255, 255, 0.16);
        box-sizing: border-box;
        position: relative;
    }
    /* A 44px target around the 36px button. */
    .voice-review-play::before {
        content: "";
        position: absolute;
        inset: -4px;
    }
    .voice-review-bars {
        flex: 1;
        min-width: 0;
        height: 26px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        overflow: hidden;
    }
    .voice-review-bars span {
        flex: none;
        width: 3px;
        border-radius: 9999px;
        background: rgba(255, 255, 255, 0.35);
    }
    .voice-review-bars span.played {
        background: #fff;
    }
</style>
