// What happens to the bot's voice when a sound is loud enough to count as someone speaking over it, for a bot in the
// limited owner rollout only (config.ts: VOICE_YIELD_BOTS). Every other session keeps today's rule: the voice stops,
// for good, at once.
//
// Here (policy `hold`, the candidate) the voice pauses instead, before its next unsent frame, and the sound is judged:
//   - it is a stop, as today (the voice stops, the person counts as speaking), once ANY of these says it is speech:
//       the speech detector hears speech from them; they said a stop word ("stop", "wait", "وقف" ...) as the first words
//       of the stretch; the stretch ended with words; the recognizer failed or the stretch was cut off; the detector
//       cannot tell (not loaded, off, behind); or nothing was settled within WATCHDOG_MS
//   - the voice goes on from the exact frame where it paused only when ALL of these hold: every stretch it paused for
//       ended with a successful, empty result and no words before it; the detector has heard no speech from each of
//       those people for SILENCE_MS (counted from the end of speech, so renewed speech starts it again), and its view is
//       fresh (it is still being given their audio); and the reply paused is still the one playing
// A sound that never reaches the gate, and a sound while the bot is not speaking, is exactly as today.
//
// Two more policies exist only to be compared against the candidate on the same input: `confirm` (the voice plays on
// and stops only once the sound is confirmed as speech) and `dip` (the voice is turned down instead of paused).
// Nothing here is a user setting.
import type { Counters } from './counters.ts';
import type { Interruptions, TurnEnd } from './recognition.ts';
import type { SessionObserver } from './speechObserver.ts';

export type YieldPolicy = 'hold' | 'confirm' | 'dip';
export const YIELD_POLICIES: readonly YieldPolicy[] = ['hold', 'confirm', 'dip'];

/** No speech heard from a person this long, after a stretch that ended empty, before the voice goes on. A starting value. */
export const SILENCE_MS = 1500;
/** The detector's view of a person is fresh while the newest audio it answered for arrived within this. */
export const FRESH_MS = 300;
/** A pause not settled within this, from the first sound it paused for, ends as a stop (today's rule). */
export const WATCHDOG_MS = 6000;
/** How often a pause looks whether it may go on. */
const TICK_MS = 100;
/** The voice's volume while turned down (policy `dip`). */
const DIP_GAIN = 0.3;
/** A stop word counts only among the first few words of a stretch, so a word in passing ("I don't want it to stop") does not. */
const COMMAND_WORDS = 4;

/** Whole words, after lower-casing and dropping punctuation. Never "no", which is mostly not a stop. */
const COMMANDS = new Set(['stop', 'wait', 'pause', 'enough', 'quiet', 'hold', 'shush', 'shh', 'وقف', 'قف', 'توقف', 'استنى', 'استنا', 'انتظر', 'اسكت', 'خلاص', 'بس']);
/** Words that turn a stop word around ("don't stop", "لا توقف"). */
const NEGATIONS = new Set(['dont', "don't", 'do', 'not', 'never', 'لا', 'ما', 'مو']);

/** True when these first words of a stretch are a stop command. */
export function isStopCommand(text: string): boolean {
    const words = text
        .toLowerCase()
        .replace(/[’]/g, "'")
        .split(/[^\p{L}\p{M}']+/u)
        .filter(Boolean);
    if (!words.length || words.length > COMMAND_WORDS) return false;
    return words.some((word, i) => COMMANDS.has(word) && !(i > 0 && NEGATIONS.has(words[i - 1])));
}

/** The parts of the speaker this needs (speaker.ts). */
export interface YieldSpeaker {
    readonly playingId: string | undefined;
    hold(): string | undefined;
    resume(segmentId: string): boolean;
    setGain(gain: number): void;
}

export interface YieldOptions {
    policy: YieldPolicy;
    counters: Counters;
    speaker: YieldSpeaker;
    observer: SessionObserver;
    silenceMs?: number;
    freshMs?: number;
    watchdogMs?: number;
}

interface Candidate {
    participantId: string;
    epoch: number;
    turnId: string;
    speech: (stopVoice: boolean) => void;
    /** How to stop waiting on the detector. */
    cancel: () => void;
    /** Undefined while the stretch is open; `empty` once it ended with nothing. */
    end?: 'empty';
}

/** One pause (or dip, or wait): the reply it is for, and the sounds it is waiting on. */
interface Episode {
    segmentId: string;
    startedAt: number;
    candidates: Map<string, Candidate>;
    tick?: NodeJS.Timeout;
}

export class YieldControl implements Interruptions {
    private episode?: Episode;
    private readonly silenceMs: number;
    private readonly freshMs: number;
    private readonly watchdogMs: number;
    private closed = false;

    constructor(private readonly options: YieldOptions) {
        this.silenceMs = options.silenceMs ?? SILENCE_MS;
        this.freshMs = options.freshMs ?? FRESH_MS;
        this.watchdogMs = options.watchdogMs ?? WATCHDOG_MS;
    }

    private count(name: string, by = 1): void {
        this.options.counters.inc(`yield_${name}`, by);
    }

    loud(turn: { participantId: string; epoch: number; turnId: string }, speech: (stopVoice: boolean) => void): boolean {
        if (this.closed) return false;
        const { speaker, observer } = this.options;
        const playing = speaker.playingId;
        // The bot is not speaking: nothing to pause, and today's rule (the person counts as speaking at once) holds back its next reply
        if (playing === undefined) {
            this.count('not_speaking');
            return false;
        }
        // The detector has no fresh view of this person (not loaded, off, beyond its limit, just started, behind): today's rule
        const view = observer.heard(turn.participantId, turn.epoch);
        if (!view || view.ageMs > this.freshMs) {
            this.count('fallback_not_fresh');
            return false;
        }
        let episode = this.episode;
        if (episode && episode.segmentId !== playing) {
            // The reply paused earlier is not the one playing any more: that pause is over, whatever it was waiting on
            this.finish(episode, 'reply_gone');
            episode = undefined;
        }
        if (!episode) {
            episode = { segmentId: playing, startedAt: performance.now(), candidates: new Map() };
            this.episode = episode;
            this.count('episodes');
            if (this.options.policy === 'hold') {
                speaker.hold();
                this.count('holds');
            } else if (this.options.policy === 'dip') {
                speaker.setGain(DIP_GAIN);
                this.count('dips');
            }
            this.watch(episode);
        }
        this.count('candidates');
        // A second stretch of the same person: the detector now answers for this one (one at a time per person), and the
        // earlier one is still settled by how it ends
        const candidate: Candidate = { ...turn, speech, cancel: () => undefined };
        episode.candidates.set(turn.turnId, candidate);
        const ep = episode;
        candidate.cancel = observer.confirm(turn.participantId, turn.epoch, (fallback) => {
            if (ep.candidates.get(turn.turnId) !== candidate) return;
            this.stop(ep, fallback ? 'confirmed_fallback' : 'confirmed_detector', candidate);
        });
        return true;
    }

    words(turnId: string, text: string): void {
        const episode = this.episode;
        const candidate = episode?.candidates.get(turnId);
        if (!episode || !candidate || candidate.end) return;
        // Ordinary words alone do not stop it (they may be someone else, or a "mm-hm"); a stop word at the start does
        if (isStopCommand(text)) this.stop(episode, 'confirmed_command', candidate);
    }

    ended(turnId: string, how: TurnEnd): void {
        const episode = this.episode;
        const candidate = episode?.candidates.get(turnId);
        if (!episode || !candidate) return;
        if (how === 'empty') {
            candidate.end = 'empty';
            this.count('ended_empty');
            this.look(episode);
            return;
        }
        if (how === 'gone') {
            // No longer heard (left, muted, a newer path, the voice stopped): nothing is proven, so the reply is not resumed
            this.finish(episode, 'person_gone', candidate);
            return;
        }
        // Words, a failure or a cut-off: it is someone speaking, as far as can be told
        this.stop(episode, how === 'text' ? 'confirmed_words' : 'confirmed_stt_failed', candidate);
    }

    /** The session is over: nothing more is done. */
    close(): void {
        this.closed = true;
        const episode = this.episode;
        if (!episode) return;
        this.episode = undefined;
        clearTimeout(episode.tick);
        for (const candidate of episode.candidates.values()) candidate.cancel();
        episode.candidates.clear();
    }

    /** Ends the episode: the detector is no longer waited on for any of it. Returns the stretches still open. */
    private end(episode: Episode): Candidate[] {
        this.episode = undefined;
        clearTimeout(episode.tick);
        const candidates = [...episode.candidates.values()];
        for (const candidate of candidates) candidate.cancel();
        episode.candidates.clear();
        return candidates.filter((c) => !c.end);
    }

    /**
     * It is speech: the paused reply stops as today, and everyone the pause was waiting on whose stretch is still open
     * counts as speaking. Only the reply that was paused is stopped: a later reply is never stopped by an earlier sound.
     */
    private stop(episode: Episode, why: string, first: Candidate | undefined): void {
        if (this.episode !== episode) return;
        this.count(why);
        this.count('stops');
        const ours = this.options.speaker.playingId === episode.segmentId;
        const open = this.end(episode);
        const stopper = first && open.includes(first) ? first : open[0];
        if (stopper) stopper.speech(ours);
        else if (ours) this.stopHeld();
        for (const candidate of open) if (candidate !== stopper) candidate.speech(false);
        if (this.options.policy === 'dip') this.options.speaker.setGain(1);
    }

    /**
     * The episode ends without proof either way. The reply went away by itself (retracted, stopped, replaced): the open
     * stretches count as speaking as today, nothing is stopped. A person is no longer heard: the paused reply stops as
     * today (it is not resumed on no evidence), and the others' open stretches count as speaking.
     */
    private finish(episode: Episode, why: 'reply_gone' | 'person_gone', gone?: Candidate): void {
        if (this.episode !== episode) return;
        this.count(why);
        const { speaker, policy } = this.options;
        const ours = speaker.playingId === episode.segmentId;
        const open = this.end(episode).filter((c) => c !== gone);
        if (why === 'person_gone' && ours && policy !== 'confirm') {
            this.count('stops');
            this.stopHeld();
        }
        if (policy === 'dip') speaker.setGain(1);
        for (const candidate of open) candidate.speech(false);
    }

    /** Stops the paused reply as today, with nobody counting as speaking. */
    private stopHeld(): void {
        this.count('stops_held');
        this.onStopHeld?.();
    }

    /** Set by the session: how to stop the paused reply as today (speaker.bargeIn). */
    onStopHeld?: () => void;

    private watch(episode: Episode): void {
        episode.tick = setTimeout(() => {
            if (this.episode !== episode) return;
            this.look(episode);
            if (this.episode === episode) this.watch(episode);
        }, TICK_MS);
        episode.tick.unref?.();
    }

    /** Whether the pause may end: a stop when it has waited too long, the voice going on when everything says it was not speech. */
    private look(episode: Episode): void {
        if (this.episode !== episode) return;
        const { speaker, observer, policy } = this.options;
        const now = performance.now();
        if (speaker.playingId !== episode.segmentId) {
            this.finish(episode, 'reply_gone');
            return;
        }
        const candidates = [...episode.candidates.values()];
        if (candidates.length && candidates.every((c) => c.end === 'empty')) {
            const quiet = candidates.every((c) => {
                const view = observer.heard(c.participantId, c.epoch);
                return view !== undefined && view.ageMs <= this.freshMs && !view.speech && view.quietMs >= this.silenceMs;
            });
            if (quiet) {
                this.end(episode);
                this.count('resumes');
                this.count('false_alarm_ms', Math.round(now - episode.startedAt));
                if (policy === 'hold') speaker.resume(episode.segmentId);
                else if (policy === 'dip') speaker.setGain(1);
                return;
            }
        }
        if (now - episode.startedAt >= this.watchdogMs) {
            // Nothing settled in time: today's rule
            this.stop(episode, 'watchdog', candidates.find((c) => !c.end) ?? candidates[0]);
        }
    }
}
