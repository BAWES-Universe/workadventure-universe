/**
 * Decides what a voice bot says out loud, and when (#1665). The bot's text never waits for this: it is written to the
 * chat as it always was, and only the finished, checked words of a reply are handed on to the voice worker.
 *
 * - Only a reply the server has checked is spoken. While a tool round or a "nothing was saved" retry is under way
 *   (`hold`), whatever is finished in between is chat only: it was not checked, and might say "done" before the result exists.
 *   When a reply still carries the "No new version was saved" line, only that line is spoken, never the claim before it.
 * - The same reply is never spoken twice, and a reconnect says nothing: nothing here runs unless a reply is finished.
 * - A person talking wins: a reply that was being written when they started to talk, or finishes while they are talking,
 *   is not spoken (a greeting included). One that is playing is stopped by the worker, and the message is marked.
 * - A greeting is finished before the person's audio has connected: it waits for it (a setting, 15 s by default), and is said once.
 * - With two voice bots in one bubble neither speaks (#1670): what one was saying stops, and replies stay in the chat.
 *   They are marked as said, so when one bot leaves nothing is replayed.
 * - When the bot's voice comes from Orbit (#1746), Orbit is asked just before each spoken turn (`beforeSpeaking`): a bot
 *   that no longer speaks answers in text for that turn, and the reply limits are the bot's own.
 * - A reply written for one person alone (#1993) is said to that person and nobody else: it is handed to the voice with
 *   their name on it, and waits for their audio, not anyone's. Someone who walks up while it plays is sent none of it.
 *   When the voice cannot keep it to them (others would hear it), it is not said, and `onKeptQuiet` says so.
 */
import { NOTHING_SAVED_LINE } from '../ai/ArtifactTools';
import { spokenVersion } from './SpokenText';
import { DEFAULT_REPLY_LIMITS, type ReplyLimits } from './settings';

/** What the voice relay gives this class. */
export interface SpeechVoice {
    /** `onlyFor`: the one person the reply is for. Their audio alone carries it, or it is not said (false). */
    say(spaceName: string, segmentId: string, text: string, maxMs?: number, onlyFor?: string): boolean;
    /** Whether someone's audio is connected so the bot is heard. With `onlyFor`: whether that person's is. */
    hasAudience(spaceName: string, onlyFor?: string): boolean;
    /** Whether a reply for this person alone would be heard by others if it were said now, so it must not be. */
    sharedWith?(spaceName: string, onlyFor: string): boolean;
    someoneSpeaking(spaceName: string): boolean;
    lastSpokenToAt(spaceName: string): number;
    /** Another voice bot is in this space: nothing is said out loud (#1670). */
    crowded?(spaceName: string): boolean;
    /** Takes back a reply's audio: what is playing stops, what is queued is dropped. */
    retract?(spaceName: string, segmentId: string): void;
    /**
     * Only for a bot whose voice Orbit decides: asked just before a reply is said. `text`: the bot does not speak now, so
     * this reply stays in the chat. `wait`: the bubble's audio is being set up again for new settings, so the reply
     * waits for it like a greeting. `speak`: say it, with these limits (the bot's own, when Orbit has them).
     */
    beforeSpeaking?(spaceName: string, turn: SpeechTurn): Promise<TurnDecision>;
    /**
     * This reply will not be spoken after all (talked over, nobody to hear it, never played). Whatever was counted for it
     * is given back. Never throws and never waits: a reply that is not spoken must not depend on it.
     */
    unspoken?(spaceName: string, turn: SpeechTurn): void;
}

/** The reply about to be said: its id (a retry or a reconnect asks again under the same one) and the person it is for, when known. */
export interface SpeechTurn {
    turnId: string;
    playerId?: number;
}

export interface TurnDecision {
    action: 'speak' | 'text' | 'wait';
    limits?: Partial<Pick<ReplyLimits, 'maxChars' | 'maxSeconds'>>;
}

/** `checking`: Orbit is being asked (see `beforeSpeaking`); what comes of it is not known yet. */
export type SpeechOutcome = 'spoken' | 'waiting' | 'held' | 'again' | 'overtaken' | 'unsaid' | 'checking';

const MAX_REMEMBERED = 200;

interface Waiting {
    responseId: string;
    /** The reply in full: the words are cut from it when it is said, with the limits of that moment. */
    reply: string;
    since: number;
    /** The one person it is for, when it was written for them alone. */
    onlyFor?: string;
}

export class BotSpeech {
    private readonly started = new Map<string, number>();
    private readonly said = new Set<string>();
    private readonly segments = new Map<string, { spaceName: string; responseId: string; heard: boolean }>();
    /** Replies whose audio is not over yet, with the space each is in. */
    private readonly unfinished = new Map<string, string>();
    /** The segments people are hearing now (round 8): the reply shows Stop speaking until its audio is over, however it ends. */
    private readonly speakingNow = new Map<string, { spaceName: string; responseId: string }>();
    private readonly held = new Set<string>();
    private readonly waiting = new Map<string, Waiting>();
    /** Replies Orbit is being asked about. They are not said yet, and not said twice meanwhile. */
    private readonly checking = new Set<string>();
    /** The timer that lets go of each waiting reply nobody came to hear. */
    private readonly waitTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private limits: ReplyLimits;
    private seq = 0;

    constructor(
        private readonly voice: SpeechVoice,
        private readonly baseLimits: ReplyLimits = DEFAULT_REPLY_LIMITS,
        private readonly now: () => number = () => performance.now()
    ) {
        this.limits = baseLimits;
    }

    /** A reply began to be written (its first words). */
    begin(responseId: string): void {
        if (!this.started.has(responseId)) remember(this.started, responseId, this.now());
    }

    /** A tool round or a retry is under way for this person's turn: whatever finishes meanwhile is chat only. */
    hold(spaceName: string, playerId: number): void {
        this.held.add(`${spaceName}\n${playerId}`);
    }

    /** The reply of this person's turn has been checked; what finishes next may be spoken. */
    release(spaceName: string, playerId: number): void {
        this.held.delete(`${spaceName}\n${playerId}`);
    }

    /** A reply is finished and in the chat in full. `onlyFor`: the one person it was written for, when they were alone with the bot. */
    final(spaceName: string, responseId: string, reply: string, onlyFor?: string): SpeechOutcome {
        const at = this.started.get(responseId) ?? this.now();
        this.started.delete(responseId);
        if (this.said.has(responseId) || this.checking.has(responseId)) return 'again';
        // Another voice bot is here: this reply stays in the chat, and is not said later either
        if (this.voice.crowded?.(spaceName)) {
            remember(this.said, responseId);
            return 'unsaid';
        }
        const person = playerOf(responseId);
        if (person !== undefined && this.held.has(`${spaceName}\n${person}`)) return 'held';
        const words = this.wordsFor(reply);
        if (!words) return 'unsaid';
        // Someone is talking, or started to while this was being written: their turn wins and this is not said
        if (this.voice.someoneSpeaking(spaceName) || this.voice.lastSpokenToAt(spaceName) > at) {
            remember(this.said, responseId);
            return 'overtaken';
        }
        if (!(onlyFor === undefined ? this.voice.hasAudience(spaceName) : this.voice.hasAudience(spaceName, onlyFor))) {
            this.park(spaceName, { responseId, reply, since: this.now(), ...(onlyFor !== undefined ? { onlyFor } : {}) });
            return 'waiting';
        }
        return this.speak(spaceName, responseId, reply, onlyFor);
    }

    /** Someone's audio has just connected in this bubble: a reply that was waiting for it is said now, once. */
    audience(spaceName: string): void {
        // A reply for one person alone waits for that person's audio: someone else's is not what it waits for
        const parked = this.waiting.get(spaceName);
        if (parked?.onlyFor !== undefined && !this.voice.hasAudience(spaceName, parked.onlyFor)) return;
        const waiting = this.unpark(spaceName);
        if (!waiting) return;
        if (this.said.has(waiting.responseId)) return;
        if (this.now() - waiting.since > this.limits.greetingWaitSeconds * 1000) {
            this.giveUp(spaceName, waiting.responseId);
            return;
        }
        if (this.voice.someoneSpeaking(spaceName)) {
            remember(this.said, waiting.responseId);
            this.giveUp(spaceName, waiting.responseId);
            return;
        }
        this.speak(spaceName, waiting.responseId, waiting.reply, waiting.onlyFor);
    }

    /**
     * A reply written for one person alone was not said out loud, because others would have heard it (#1993). It is in
     * that person's chat in full.
     */
    onKeptQuiet?: (spaceName: string, responseId: string) => void;

    /** Called when the audio of a reply for this person is over, however it ended (#1220: their follow-up window starts then). */
    onOver?: (spaceName: string, personId: number) => void;
    /** A reply began to be heard (true), or its audio is over (false), however it ended (round 8). Never twice the same way for a segment. */
    onSpeaking?: (spaceName: string, responseId: string, speaking: boolean) => void;

    /** Whether a reply for this person is being played now. */
    isSpeakingTo(personId: number): boolean {
        for (const segmentId of this.unfinished.keys()) {
            const segment = this.segments.get(segmentId);
            if (segment && playerOf(segment.responseId) === personId) return true;
        }
        return false;
    }

    /** The audio of a reply is over, however it ended. */
    played(segmentId: string): void {
        this.unfinished.delete(segmentId);
        this.quiet(segmentId);
        const segment = this.segments.get(segmentId);
        const person = segment ? playerOf(segment.responseId) : undefined;
        if (segment && person !== undefined) this.onOver?.(segment.spaceName, person);
    }

    /** A second voice bot arrived in this space: what was waiting is dropped, and what is playing or queued stops. */
    crowded(spaceName: string): void {
        const waiting = this.unpark(spaceName);
        if (waiting) {
            remember(this.said, waiting.responseId);
            this.giveUp(spaceName, waiting.responseId);
        }
        for (const [segmentId, space] of [...this.unfinished]) {
            if (space !== spaceName) continue;
            this.unfinished.delete(segmentId);
            this.quiet(segmentId);
            this.voice.retract?.(spaceName, segmentId);
        }
    }

    /**
     * This person told the bot they are done talking with it (#1670): what is playing for them stops, what is queued for
     * them is dropped, and what was waiting for an audience for them is not said later. Nothing here is counted as an
     * answer to them, so their follow-up window does not start again when the audio ends. Others' replies are not touched.
     */
    endFor(spaceName: string, personId: number): void {
        const waiting = this.waiting.get(spaceName);
        if (waiting && playerOf(waiting.responseId) === personId) {
            this.unpark(spaceName);
            remember(this.said, waiting.responseId);
            this.giveUp(spaceName, waiting.responseId);
        }
        for (const [segmentId, space] of [...this.unfinished]) {
            const segment = this.segments.get(segmentId);
            if (space !== spaceName || !segment || playerOf(segment.responseId) !== personId) continue;
            this.unfinished.delete(segmentId);
            this.quiet(segmentId);
            // Forgotten here, so the report that it ended does not count as an answer that opens their window again
            this.segments.delete(segmentId);
            this.voice.retract?.(spaceName, segmentId);
            // Not a moment of it was heard: what was counted for it is given back
            if (!segment.heard) this.giveUp(spaceName, segment.responseId);
        }
    }

    /** The voice worker cut a segment short because someone spoke: which reply it was, if it is one of ours. */
    stopped(spaceName: string, segmentId: string): string | undefined {
        const segment = this.segments.get(segmentId);
        return segment && segment.spaceName === spaceName ? segment.responseId : undefined;
    }

    /**
     * The voice worker finished a segment without a moment of it being heard (refused, retracted, a provider that
     * failed before any audio, talked over before it began). The person did not get this reply in voice.
     */
    unplayed(spaceName: string, segmentId: string): void {
        const segment = this.segments.get(segmentId);
        if (!segment || segment.spaceName !== spaceName) return;
        this.segments.delete(segmentId);
        this.giveUp(spaceName, segment.responseId);
    }

    /** Some of this segment has been played to someone: the reply stays counted, whatever happens to the session next. */
    heard(spaceName: string, segmentId: string): void {
        const segment = this.segments.get(segmentId);
        if (!segment || segment.spaceName !== spaceName) return;
        segment.heard = true;
        if (this.unfinished.has(segmentId) && !this.speakingNow.has(segmentId)) {
            this.speakingNow.set(segmentId, { spaceName, responseId: segment.responseId });
            this.onSpeaking?.(spaceName, segment.responseId, true);
        }
    }

    /**
     * Someone in the space tapped Stop speaking on this reply (round 8): what is playing of it stops. True when it was being
     * heard (the reply is then marked as stopped). Nothing else changes: listening, modes and follow-up windows are as they
     * were, and its end opens no window (a tap to stop it is not a reply having been said).
     */
    stopReply(spaceName: string, responseId: string): boolean {
        let stopped = false;
        for (const [segmentId, space] of [...this.unfinished]) {
            const segment = this.segments.get(segmentId);
            if (space !== spaceName || !segment || segment.responseId !== responseId) continue;
            if (this.speakingNow.has(segmentId)) stopped = true;
            this.unfinished.delete(segmentId);
            this.quiet(segmentId);
            // Forgotten here, as when someone says they are done: the report that it ended is not an answer that opens a follow-up window
            this.segments.delete(segmentId);
            this.voice.retract?.(spaceName, segmentId);
            // Not a moment of it was heard: what was counted for it is given back
            if (!segment.heard) this.giveUp(spaceName, segment.responseId);
        }
        return stopped;
    }

    /**
     * Someone else came into the space while a reply written for one person alone was playing or about to, on a voice that
     * speaks to the whole bubble (#1993): what is playing or queued of it stops. `stopped` when it was being heard,
     * `unsaid` when it had not begun, nothing when none of it was on its way. A reply that is still being written, or
     * waits for its person's audio, is decided when it is said (see `say`).
     */
    hush(spaceName: string, responseId: string): 'stopped' | 'unsaid' | undefined {
        let pending = false;
        for (const [segmentId, space] of this.unfinished) {
            if (space === spaceName && this.segments.get(segmentId)?.responseId === responseId) pending = true;
        }
        if (this.stopReply(spaceName, responseId)) return 'stopped';
        return pending ? 'unsaid' : undefined;
    }

    /** This segment's audio is over for the people in the space: its reply stops showing Stop speaking. */
    private quiet(segmentId: string): void {
        const speaking = this.speakingNow.get(segmentId);
        if (!speaking) return;
        this.speakingNow.delete(segmentId);
        this.onSpeaking?.(speaking.spaceName, speaking.responseId, false);
    }

    /**
     * A bubble's audio session ended (the person left, the voice was opened again, the worker went away): a reply that was
     * sent to it and never began to play will not play now, and its final report may never come. Those are given back.
     */
    sessionEnded(spaceName: string): void {
        // What was already playing has no one to report its end now: it is not "being played" any more (#1220)
        for (const [segmentId, space] of [...this.unfinished]) {
            if (space !== spaceName) continue;
            this.unfinished.delete(segmentId);
            this.quiet(segmentId);
        }
        for (const [segmentId, segment] of [...this.segments]) {
            if (segment.spaceName !== spaceName || segment.heard) continue;
            this.segments.delete(segmentId);
            this.giveUp(spaceName, segment.responseId);
        }
    }

    spaceLeft(spaceName: string): void {
        const waiting = this.unpark(spaceName);
        if (waiting) this.giveUp(spaceName, waiting.responseId);
        for (const [segmentId, space] of [...this.unfinished]) {
            if (space !== spaceName) continue;
            this.unfinished.delete(segmentId);
            this.quiet(segmentId);
        }
        for (const key of this.held) if (key.startsWith(`${spaceName}\n`)) this.held.delete(key);
    }

    /** The bot is going away: whatever was waiting for someone to hear it will not be said. */
    shutdown(): void {
        for (const spaceName of [...this.waiting.keys()]) this.spaceLeft(spaceName);
    }

    /** A reply waits for someone's audio. One it replaces, or one nobody comes for, is let go. */
    private park(spaceName: string, waiting: Waiting): void {
        const displaced = this.unpark(spaceName);
        if (displaced && displaced.responseId !== waiting.responseId) this.giveUp(spaceName, displaced.responseId);
        this.waiting.set(spaceName, waiting);
        const timer = setTimeout(() => {
            if (this.waiting.get(spaceName)?.responseId !== waiting.responseId) return;
            this.waiting.delete(spaceName);
            this.waitTimers.delete(spaceName);
            this.giveUp(spaceName, waiting.responseId);
        }, this.limits.greetingWaitSeconds * 1000);
        timer.unref?.();
        this.waitTimers.set(spaceName, timer);
    }

    private unpark(spaceName: string): Waiting | undefined {
        const waiting = this.waiting.get(spaceName);
        this.waiting.delete(spaceName);
        const timer = this.waitTimers.get(spaceName);
        if (timer) clearTimeout(timer);
        this.waitTimers.delete(spaceName);
        return waiting;
    }

    /** This reply will not be spoken: what was counted for it is given back. A failure there never reaches the reply. */
    private giveUp(spaceName: string, responseId: string): void {
        try {
            this.voice.unspoken?.(spaceName, { turnId: responseId, playerId: playerOf(responseId) });
        } catch {
            // Giving it back is best effort
        }
    }

    private wordsFor(reply: string): string {
        // A reply that still carries the "nothing was saved" line said it made something it did not: only the line is true
        if (reply.includes(NOTHING_SAVED_LINE)) return NOTHING_SAVED_LINE;
        return spokenVersion(reply, this.limits.maxChars);
    }

    private speak(spaceName: string, responseId: string, reply: string, onlyFor?: string): SpeechOutcome {
        if (this.voice.crowded?.(spaceName)) {
            remember(this.said, responseId);
            // A reply that waited for its audience may already be counted: it is given back (nothing happens if it was not)
            this.giveUp(spaceName, responseId);
            return 'unsaid';
        }
        const ask = this.voice.beforeSpeaking;
        if (!ask) return this.say(spaceName, responseId, reply, onlyFor);
        const askedAt = this.now();
        this.checking.add(responseId);
        ask.call(this.voice, spaceName, { turnId: responseId, playerId: playerOf(responseId) }).then(
            (decision) => this.decided(spaceName, responseId, reply, askedAt, decision, onlyFor),
            // Orbit could not be asked: the reply stays in the chat
            () => this.decided(spaceName, responseId, reply, askedAt, { action: 'text' }, onlyFor)
        );
        return 'checking';
    }

    private decided(spaceName: string, responseId: string, reply: string, askedAt: number, decision: TurnDecision, onlyFor?: string): void {
        this.checking.delete(responseId);
        if (decision.action === 'text') {
            remember(this.said, responseId);
            // Nothing is counted for a reply turned down, but one counted just before the bubble went away is
            this.giveUp(spaceName, responseId);
            return;
        }
        if (decision.action === 'wait') {
            this.park(spaceName, { responseId, reply, since: this.now(), ...(onlyFor !== undefined ? { onlyFor } : {}) });
            return;
        }
        // The answer took a moment: a person who started talking meanwhile wins, as for any reply
        if (this.voice.someoneSpeaking(spaceName) || this.voice.lastSpokenToAt(spaceName) > askedAt) {
            remember(this.said, responseId);
            this.giveUp(spaceName, responseId);
            return;
        }
        this.limits = { ...this.baseLimits, ...decision.limits };
        this.say(spaceName, responseId, reply, onlyFor);
    }

    private say(spaceName: string, responseId: string, reply: string, onlyFor?: string): SpeechOutcome {
        const words = this.wordsFor(reply);
        if (!words) {
            remember(this.said, responseId);
            this.giveUp(spaceName, responseId);
            return 'unsaid';
        }
        // Written for one person, and others would hear it now: it stays in that person's chat, and they are told why
        if (onlyFor !== undefined && this.voice.sharedWith?.(spaceName, onlyFor)) {
            remember(this.said, responseId);
            this.giveUp(spaceName, responseId);
            this.onKeptQuiet?.(spaceName, responseId);
            return 'unsaid';
        }
        const segmentId = `s${++this.seq}`;
        remember(this.said, responseId);
        const maxMs = Math.max(1000, this.limits.maxSeconds * 1000);
        const sent = onlyFor === undefined ? this.voice.say(spaceName, segmentId, words, maxMs) : this.voice.say(spaceName, segmentId, words, maxMs, onlyFor);
        if (!sent) {
            this.giveUp(spaceName, responseId);
            return 'unsaid';
        }
        this.segments.set(segmentId, { spaceName, responseId, heard: false });
        remember(this.unfinished, segmentId, spaceName);
        for (const oldest of this.segments.keys()) {
            if (this.segments.size <= MAX_REMEMBERED) break;
            this.segments.delete(oldest);
        }
        return 'spoken';
    }
}

/** The person a reply is for, from the id the behaviours give it ("bot-<bot>-player-<id>-<uuid>"). */
function playerOf(responseId: string): number | undefined {
    const at = responseId.lastIndexOf('-player-');
    if (at < 0) return undefined;
    const digits = /^\d+/.exec(responseId.slice(at + '-player-'.length));
    return digits ? Number(digits[0]) : undefined;
}

function remember<K, V>(map: Map<K, V>, key: K, value: V): void;
function remember<K>(set: Set<K>, key: K): void;
function remember(store: Map<unknown, unknown> | Set<unknown>, key: unknown, value?: unknown): void {
    if (store instanceof Map) store.set(key, value);
    else store.add(key);
    for (const oldest of store.keys()) {
        if (store.size <= MAX_REMEMBERED) break;
        store.delete(oldest);
    }
}
