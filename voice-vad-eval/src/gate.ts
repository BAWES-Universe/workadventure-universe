// Today's detector, unmodified: the worker's own Recognition class, fed offline. The only stand-in is the speech
// provider (no words, no network). It reports when the worker would have stopped the bot's voice, how many
// speech-to-text streams it would have opened and how much audio it would have sent them.
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

export function runGate(pcm: Int16Array, bargeInMs: number, frameSamples: number): GateResult {
    const triggers: number[] = [];
    let turnsOpened = 0;
    let sttMs = 0;
    let clock = 0;
    let talkingMs = 0;
    const talkingSince = new Map<string, number>();
    const recognition = new Recognition({
        factory: (events) => {
            turnsOpened++;
            return {
                push: (audio) => {
                    sttMs += (audio.length * 1000) / RATE;
                },
                finish: () => events.final(''),
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
