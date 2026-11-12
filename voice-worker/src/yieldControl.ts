// What happens to the bot's voice when a sound is loud enough to count as someone speaking over it, for a bot in the
// limited owner rollout only (config.ts: VOICE_YIELD_BOTS). Every other session keeps today's rule: the voice stops,
// for good, at once.
//
// Here (policy `hold`, the candidate) the voice pauses instead, before its next unsent frame, and the sound is judged:
//   - it is a STOP, as today (the voice stops, the person counts as speaking), once any of these says it is speech:
//       the speech detector hears speech from them (recently enough to decide on); the stretch begins with a stop
//       command ("stop", "wait", "hold on", "وقف" ...); the stretch ends with words, or with words taken back; the
//       recognizer fails, or audio of theirs goes missing; the detector cannot tell (not loaded, off, slow); or nothing
//       settles within WATCHDOG_MS while paused
//   - it is a RESOLVED FALSE ALARM, and the voice goes on from the exact frame, when every stretch it paused for ended
//       with a successful empty result (no words ever, no audio missing), the detector has followed each of those people
//       without a break since the sound and heard no speech for SILENCE_MS of it, and the same reply is still playing
//   - it is a PROVISIONAL CONTINUATION when the stretch is still open (a fan keeps the volume gate open, so the
//       recognizer never finishes) but the detector has followed each person without a break since the sound and heard
//       no speech for SILENCE_MS of it, and no words have ever come: the voice goes on, and the open stretch is still
//       watched until it ends. Any words from it, speech from the detector, a failure, missing audio or a break in the
//       detector's view then stops the reply as today. This is not counted as a false alarm: nothing proves it was one.
//       A detector that misses speech while the recognizer has no words yet can still let the voice go on over someone.
// A sound that never reaches the gate, and a sound while the bot is not speaking, is exactly as today (except that,
// while the bot speaks, words that come before the gate do not announce the stretch until it is judged or ends).
//
// Two more policies exist only to be compared against the candidate on the same input: `confirm` (the voice plays on
// and stops only once the sound is confirmed as speech) and `dip` (the voice is turned down instead of paused). Neither
// continues provisionally. Nothing here is a user setting.
import type { Counters } from './counters.ts';
import type { Interruptions, TurnEnd } from './recognition.ts';
import type { SessionObserver } from './speechObserver.ts';

export type YieldPolicy = 'hold' | 'confirm' | 'dip';
export const YIELD_POLICIES: readonly YieldPolicy[] = ['hold', 'confirm', 'dip'];

/** No speech heard from a person this long, within the time since the sound, before the voice goes on. Tuned on the tune half (see voice-vad-eval). */
export const SILENCE_MS = 1500;
/** The detector's view of a person is fresh while the newest audio it answered for arrived within this. */
export const FRESH_MS = 300;
/** A pause not settled within this, from the first sound it paused for, ends as a stop (today's rule). Only while paused. */
export const WATCHDOG_MS = 6000;
/** How often a pause, or a provisional continuation, looks at the evidence. */
const TICK_MS = 100;
/** The voice's volume while turned down (policy `dip`). */
const DIP_GAIN = 0.3;

/**
 * A stop command is recognised only at the very start of a stretch: up to two openers ("please", "ok", "hey"), then a
 * command word or phrase. Whatever follows is the command's own business ("stop talking right now please"). Anything
 * else, a stop word later in the sentence ("a bus stop", "he said stop", "please don't ever stop") included, is not a
 * shortcut: it still stops the bot through the general path once the stretch ends with words. English and Arabic only;
 * every other language has the general paths.
 */
const OPENERS = new Set(['please', 'ok', 'okay', 'oh', 'hey', 'um', 'uh', 'so', 'just', 'no', 'يا', 'طيب', 'لو', 'سمحت']);
/** A command word alone. */
const COMMANDS = new Set(['stop', 'wait', 'pause', 'enough', 'quiet', 'shush', 'shh', 'silence', 'وقف', 'قف', 'توقف', 'استنى', 'استنا', 'انتظر', 'اسكت', 'خلاص']);
/** Two-word commands whose first word alone is not one. */
const PHRASES = new Set(['hold on', 'hold up', 'hang on', 'be quiet', 'shut up', 'one second', 'one sec', 'لحظة واحدة', 'دقيقة بس']);
/** At most this many openers before the command. */
const MAX_OPENERS = 2;

/** True when a stretch begins with a stop command. */
export function isStopCommand(text: string): boolean {
    const words = text
        .toLowerCase()
        .replace(/[\u2019]/g, "'")
        .split(/[^\p{L}\p{M}']+/u)
        .filter(Boolean);
    for (let i = 0; i <= MAX_OPENERS && i < words.length; i++) {
        if (COMMANDS.has(words[i])) return true;
        if (i + 1 < words.length && PHRASES.has(`${words[i]} ${words[i + 1]}`)) return true;
        if (!OPENERS.has(words[i])) return false;
    }
    return false;
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
    /** Provisional continuation for an open stretch (policy `hold` only). Default on. */
    provisional?: boolean;
}

interface Candidate {
    participantId: string;
    epoch: number;
    turnId: string;
    speech: (stopVoice: boolean) => void;
    /** How to stop waiting on the detector. */
    cancel: () => void;
    /** When it was asked about, and which unbroken run of the detector's view of this person it began in. */
    at: number;
    stream?: number;
    droppedMs: number;
    /** Undefined while the stretch is open; `empty` once it ended with nothing. */
    end?: 'empty';
    /** Words came through for this stretch at some point. */
    words: boolean;
}

/** One pause (or dip, or wait) on one reply, and the stretches it is waiting on. */
interface Episode {
    segmentId: string;
    /** When the current pause began (the watchdog runs only while paused). */
    pausedAt: number;
    candidates: Map<string, Candidate>;
    /** paused: the voice is held (or turned down, or waiting). continuing: it goes on, provisionally, while open stretches are watched. */
    phase: 'paused' | 'continuing';
    tick?: NodeJS.Timeout;
}

export class YieldControl implements Interruptions {
    private episode?: Episode;
    private readonly silenceMs: number;
    private readonly freshMs: number;
    private readonly watchdogMs: number;
    private readonly provisional: boolean;
    private closed = false;

    constructor(private readonly options: YieldOptions) {
        this.silenceMs = options.silenceMs ?? SILENCE_MS;
        this.freshMs = options.freshMs ?? FRESH_MS;
        this.watchdogMs = options.watchdogMs ?? WATCHDOG_MS;
        this.provisional = options.policy === 'hold' && options.provisional !== false;
    }

    /** Set by the session: how to stop the paused reply as today (speaker.bargeIn), with nobody counting as speaking. */
    onStopHeld?: () => void;

    private count(name: string, by = 1): void {
        this.options.counters.inc(`yield_${name}`, by);
    }

    owns(): boolean {
        return !this.closed && this.options.speaker.playingId !== undefined;
    }

    loud(turn: { participantId: string; epoch: number; turnId: string; heard: string }, speech: (stopVoice: boolean) => void): boolean {
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
        // Words that came before the gate: a stop command is a stop at once, as today
        if (turn.heard && isStopCommand(turn.heard)) {
            this.count('confirmed_command_early');
            return false;
        }
        let episode = this.episode;
        if (episode && episode.segmentId !== playing) {
            // The reply paused earlier is not the one playing any more: that pause is over, whatever it was waiting on
            this.finish(episode, 'reply_gone');
            episode = undefined;
        }
        const now = performance.now();
        if (!episode) {
            episode = { segmentId: playing, pausedAt: now, candidates: new Map(), phase: 'paused' };
            this.episode = episode;
            this.count('episodes');
            this.yieldVoice();
            this.watch(episode);
        } else if (episode.phase === 'continuing') {
            // A new sound while going on provisionally: it pauses again (the stretch already watched does not)
            episode.phase = 'paused';
            episode.pausedAt = now;
            this.count('repauses');
            this.yieldVoice();
        }
        this.count('candidates');
        const candidate: Candidate = { participantId: turn.participantId, epoch: turn.epoch, turnId: turn.turnId, speech, cancel: () => undefined, at: now, stream: view.stream, droppedMs: view.droppedMs, words: turn.heard !== '' };
        episode.candidates.set(turn.turnId, candidate);
        const ep = episode;
        candidate.cancel = observer.confirm(turn.participantId, turn.epoch, (fallback) => {
            if (ep.candidates.get(turn.turnId) !== candidate) return;
            const why = fallback ? 'confirmed_fallback' : 'confirmed_detector';
            this.stop(ep, ep.phase === 'continuing' ? `${why}_while_continuing` : why, candidate);
        });
        return true;
    }

    private yieldVoice(): void {
        const { speaker, policy } = this.options;
        if (policy === 'hold') {
            speaker.hold();
            this.count('holds');
        } else if (policy === 'dip') {
            speaker.setGain(DIP_GAIN);
            this.count('dips');
        }
    }

    words(turnId: string, text: string): void {
        const episode = this.episode;
        const candidate = episode?.candidates.get(turnId);
        if (!episode || !candidate || candidate.end || !text) return;
        candidate.words = true;
        // While going on provisionally, any words at all are taken as someone speaking
        if (episode.phase === 'continuing') this.stop(episode, 'confirmed_words_while_continuing', candidate);
        // While paused, ordinary words alone do not stop it (they may be someone else, or a "mm-hm"); a stop command does
        else if (isStopCommand(text)) this.stop(episode, 'confirmed_command', candidate);
    }

    ended(turnId: string, how: TurnEnd): void {
        const episode = this.episode;
        const candidate = episode?.candidates.get(turnId);
        if (!episode || !candidate) return;
        if (how === 'empty' && !candidate.words) {
            candidate.end = 'empty';
            this.count('ended_empty');
            this.look(episode);
            return;
        }
        if (episode.phase === 'continuing' && (how === 'gone' || (how === 'capped' && !candidate.words))) {
            // Going on already: a stretch that ends with no evidence either way (the person left, or the length limit
            // with no words ever) is no longer watched, and nothing is stopped
            this.count(how === 'gone' ? 'continuing_person_gone' : 'continuing_capped');
            candidate.cancel();
            episode.candidates.delete(turnId);
            if (!episode.candidates.size) this.end(episode);
            return;
        }
        if (how === 'gone') {
            // No longer heard (left, muted, a newer path, the voice stopped): nothing is proven, so the reply is not resumed
            this.finish(episode, 'person_gone', candidate);
            return;
        }
        // Words (even taken back), a failure, missing audio or the limit: someone speaking, as far as can be told
        const why = how === 'text' || how === 'retracted' ? 'confirmed_words' : 'confirmed_stt_failed';
        this.stop(episode, episode.phase === 'continuing' ? `${why}_while_continuing` : why, candidate);
    }

    /** The session is over: nothing more is done. */
    close(): void {
        this.closed = true;
        if (this.episode) this.end(this.episode);
    }

    /** Ends the episode: the detector is no longer waited on for any of it. Returns the stretches still open. */
    private end(episode: Episode): Candidate[] {
        if (this.episode === episode) this.episode = undefined;
        clearTimeout(episode.tick);
        const candidates = [...episode.candidates.values()];
        for (const candidate of candidates) candidate.cancel();
        episode.candidates.clear();
        return candidates.filter((c) => !c.end);
    }

    /**
     * It is speech: the reply stops as today, and everyone the episode was waiting on whose stretch is still open
     * counts as speaking. Only the reply the episode is about is stopped: a later reply is never stopped by an earlier sound.
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
     * The episode ends without proof either way. The reply went away by itself (finished, retracted, stopped, replaced):
     * nothing is stopped, and the stretches still open count as speaking, as today (they hold back the next reply until
     * they end). That includes stretches only being watched after a provisional continuation: once the reply they were
     * watched for is gone, nothing watches them, so they fall back to today's rule, and an old stretch never stops a
     * replacement reply. A person is no longer heard while paused: the paused reply
     * stops as today (it is not resumed on no evidence), and the others' open stretches count as speaking.
     */
    private finish(episode: Episode, why: 'reply_gone' | 'person_gone', gone?: Candidate): void {
        if (this.episode !== episode) return;
        this.count(why);
        const { speaker, policy } = this.options;
        const ours = speaker.playingId === episode.segmentId;
        const continuing = episode.phase === 'continuing';
        const open = this.end(episode).filter((c) => c !== gone);
        if (why === 'person_gone' && ours && policy !== 'confirm') {
            this.count('stops');
            this.stopHeld();
        }
        if (policy === 'dip') speaker.setGain(1);
        if (continuing) this.count('continuing_released', open.length);
        for (const candidate of open) candidate.speech(false);
    }

    private stopHeld(): void {
        this.count('stops_held');
        this.onStopHeld?.();
    }

    private watch(episode: Episode): void {
        episode.tick = setTimeout(() => {
            if (this.episode !== episode) return;
            this.look(episode);
            if (this.episode === episode) this.watch(episode);
        }, TICK_MS);
        episode.tick.unref?.();
    }

    /**
     * The detector has followed this person without a break since the sound, and is fresh. With `quiet`, it has also
     * heard no speech from them for SILENCE_MS of the time since the sound (quiet from before the sound does not count).
     */
    private followed(candidate: Candidate, now: number, quiet: boolean): boolean {
        const view = this.options.observer.heard(candidate.participantId, candidate.epoch);
        if (!view || view.ageMs > this.freshMs || view.stream !== candidate.stream || view.droppedMs !== candidate.droppedMs || view.speech) return false;
        if (!quiet) return true;
        const answeredAt = now - view.ageMs;
        return answeredAt - Math.max(answeredAt - view.quietMs, candidate.at) >= this.silenceMs;
    }

    /** What the evidence says now. */
    private look(episode: Episode): void {
        if (this.episode !== episode) return;
        const { speaker, policy } = this.options;
        const now = performance.now();
        if (speaker.playingId !== episode.segmentId) {
            this.finish(episode, 'reply_gone');
            return;
        }
        const candidates = [...episode.candidates.values()];
        if (episode.phase === 'continuing') {
            // Going on provisionally: every stretch still open must stay followed; one that loses that is a stop
            const lost = candidates.find((c) => !c.end && !this.followed(c, now, false));
            if (lost) {
                // Speech heard on an unbroken view is the detector confirming; anything else is the view lost
                const view = this.options.observer.heard(lost.participantId, lost.epoch);
                const speech = view?.speech === true && view.ageMs <= this.freshMs && view.stream === lost.stream && view.droppedMs === lost.droppedMs;
                this.stop(episode, speech ? 'confirmed_detector_while_continuing' : 'continuing_view_lost', lost);
            }
            else if (candidates.every((c) => c.end === 'empty')) {
                this.count('continuing_resolved_empty');
                this.end(episode);
            }
            return;
        }
        // A resolved false alarm: every stretch ended empty, and each person has been quiet long enough since the sound
        if (candidates.length && candidates.every((c) => c.end === 'empty' && this.followed(c, now, true))) {
            this.end(episode);
            this.count('resumes');
            this.count('false_alarm_ms', Math.round(now - episode.pausedAt));
            if (policy === 'hold') speaker.resume(episode.segmentId);
            else if (policy === 'dip') speaker.setGain(1);
            return;
        }
        // A provisional continuation: stretches still open, no words ever, everyone followed and quiet long enough since the sound
        if (this.provisional && candidates.some((c) => !c.end) && candidates.every((c) => !c.words && this.followed(c, now, true))) {
            episode.phase = 'continuing';
            this.count('continues');
            this.count('continue_ms', Math.round(now - episode.pausedAt));
            speaker.resume(episode.segmentId);
            return;
        }
        if (now - episode.pausedAt >= this.watchdogMs) {
            // Nothing settled in time while paused: today's rule
            this.stop(episode, 'watchdog', candidates.find((c) => !c.end) ?? candidates[0]);
        }
    }
}
