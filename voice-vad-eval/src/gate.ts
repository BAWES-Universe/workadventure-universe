// Today's detector, unmodified: the worker's own Recognition class, fed offline. The only stand-in is the speech
// provider. This is a SPECIFIED FAKE-PROVIDER BASELINE, not every deployed provider's behaviour: the fake waits 1.8 s of
// quiet (Soniox's fallback), never says the person finished (no endpoint events), and either says no words at all
// ("silent") or one more word for every 300 ms of audio it is sent ("words": the provider-partial route, which also
// announces speech). It reports when the worker would have stopped the bot's voice, how many speech-to-text streams it
// would have opened, how much audio it would have sent them, and how long it held "someone is speaking".
import { Counters } from '../../voice-worker/src/counters.ts';
import { Recognition } from '../../voice-worker/src/recognition.ts';
import { RATE } from './fixtures.ts';

/** Soniox (Universe AI's hearing) waits this long for quiet as its fallback; the turn stays open until then. */
export const PROVIDER_PAUSE_MS = 1800;

export interface GateResult {
    /** Seconds into the clip at which the bot's voice would have been stopped (once per stretch). */
    triggers: number[];
    turnsOpened: number;
    sttMs: number;
    /** How long the worker held "someone is speaking" (from user.speech_started to the end of that stretch): replies wait all that time. */
    talkingMs: number;
}

export type ProviderScript = 'silent' | 'words';

export function runGate(pcm: Int16Array, bargeInMs: number, frameSamples: number, provider: ProviderScript = 'silent'): GateResult {
    const triggers: number[] = [];
    let turnsOpened = 0;
    let sttMs = 0;
    let clock = 0;
    let talkingMs = 0;
    const talkingSince = new Map<string, number>();
    const recognition = new Recognition({
        factory: (events) => {
            turnsOpened++;
            let heardMs = 0;
            let words = 0;
            return {
                push: (audio) => {
                    const ms = (audio.length * 1000) / RATE;
                    sttMs += ms;
                    heardMs += ms;
                    if (provider === 'words' && Math.floor(heardMs / 300) > words) {
                        words = Math.floor(heardMs / 300);
                        events.partial('word '.repeat(words).trim());
                    }
                },
                finish: () => events.final(provider === 'words' ? 'word '.repeat(words).trim() : ''),
                close: () => undefined,
                pauseMs: PROVIDER_PAUSE_MS,
            };
        },
        maxUtteranceMs: 180000,
        counters: new Counters(),
        send: (message) => {
            if (message.type === 'user.speech_started') talkingSince.set(message.turnId, clock);
            else if (message.type === 'user.turn' && talkingSince.has(message.turnId)) {
                talkingMs += ((clock - talkingSince.get(message.turnId)!) * 1000) / RATE;
                talkingSince.delete(message.turnId);
            }
        },
        bargeInMs,
        onSpeaking: () => triggers.push(clock / RATE),
    });
    for (let at = 0; at + frameSamples <= pcm.length; at += frameSamples) {
        clock = at + frameSamples;
        recognition.sink({ participantId: 'p', epoch: 1, pcm16k: pcm.subarray(at, at + frameSamples), droppedMs: 0 });
    }
    // A stretch still open at the end of the clip was "speaking" until then
    for (const since of talkingSince.values()) talkingMs += ((clock - since) * 1000) / RATE;
    recognition.dispose();
    return { triggers, turnsOpened, sttMs, talkingMs };
}

/**
 * The candidate through the SAME lifecycle: the worker's unchanged Recognition class, but "is this frame speech" comes
 * from Silero's verdict instead of loudness. Each 20 ms frame takes the verdict of the last 32 ms window that had fully
 * arrived by the frame's end (so the delay of waiting for a window is in), and is handed over as loud or as silence.
 * Turn opening, the 1.8 s quiet, speech_started, partials and the end of the stretch are then exactly today's code.
 */
export function runLifecycleOnVerdicts(probs: ArrayLike<number>, on: number, seconds: number, bargeInMs: number, provider: ProviderScript): GateResult {
    const frames = Math.floor((seconds * RATE) / 320);
    const pcm = new Int16Array(frames * 320);
    for (let f = 0; f < frames; f++) {
        const window = Math.floor(((f + 1) * 320) / 512) - 1;
        if (window >= 0 && window < probs.length && probs[window] >= on) pcm.fill(8000, f * 320, (f + 1) * 320);
    }
    return runGate(pcm, bargeInMs, 320, provider);
}
