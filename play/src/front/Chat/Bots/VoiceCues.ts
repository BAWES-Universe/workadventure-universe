/**
 * The two soft sounds of listening in a group (round 8), on this person's device only: a falling pair of notes when a bot stops hearing
 * them because a friend joined, and a rising pair when the bot is confirmed to listen again. Quiet, short, and made here, so there is no
 * file to load. Nothing plays when the person's status keeps notification sounds quiet (busy, do not disturb), or when the browser has not
 * let sound start yet.
 */
import { audioContextManager } from "../../WebRtc/AudioContextManager";
import { statusChanger } from "../../Components/ActionBar/AvailabilityStatus/statusChanger";

export type VoiceCue = "paused" | "ready";

const NOTES: Record<VoiceCue, [number, number]> = {
    paused: [660, 495],
    ready: [495, 742],
};
const VOLUME = 0.08;
const NOTE_S = 0.11;

export function playVoiceCue(cue: VoiceCue): void {
    try {
        if (!statusChanger.allowNotificationSound()) return;
        const context = audioContextManager.getContext();
        if (context.state !== "running") return;
        const start = context.currentTime + 0.01;
        NOTES[cue].forEach((frequency, index) => {
            const at = start + index * NOTE_S;
            const oscillator = context.createOscillator();
            const gain = context.createGain();
            oscillator.type = "sine";
            oscillator.frequency.value = frequency;
            gain.gain.setValueAtTime(0, at);
            gain.gain.linearRampToValueAtTime(VOLUME, at + 0.015);
            gain.gain.exponentialRampToValueAtTime(0.0001, at + NOTE_S + 0.08);
            oscillator.connect(gain).connect(context.destination);
            oscillator.start(at);
            oscillator.stop(at + NOTE_S + 0.1);
        });
    } catch {
        // A sound is a courtesy: the bar says the same in words
    }
}
