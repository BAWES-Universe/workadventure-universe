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
 */
import { NOTHING_SAVED_LINE } from '../ai/ArtifactTools';
import { spokenVersion } from './SpokenText';
import { DEFAULT_REPLY_LIMITS, type ReplyLimits } from './settings';

/** What the voice relay gives this class. */
export interface SpeechVoice {
    say(spaceName: string, segmentId: string, text: string, maxMs?: number): boolean;
    hasAudience(spaceName: string): boolean;
    someoneSpeaking(spaceName: string): boolean;
    lastSpokenToAt(spaceName: string): number;
}

export type SpeechOutcome = 'spoken' | 'waiting' | 'held' | 'again' | 'overtaken' | 'unsaid';

const MAX_REMEMBERED = 200;

interface Waiting {
    responseId: string;
    text: string;
    since: number;
}

export class BotSpeech {
    private readonly started = new Map<string, number>();
    private readonly said = new Set<string>();
    private readonly segments = new Map<string, { spaceName: string; responseId: string }>();
    private readonly held = new Set<string>();
    private readonly waiting = new Map<string, Waiting>();
    private seq = 0;

    constructor(
        private readonly voice: SpeechVoice,
        private readonly limits: ReplyLimits = DEFAULT_REPLY_LIMITS,
        private readonly now: () => number = () => performance.now()
    ) {}

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

    /** A reply is finished and in the chat in full. */
    final(spaceName: string, responseId: string, reply: string): SpeechOutcome {
        const at = this.started.get(responseId) ?? this.now();
        this.started.delete(responseId);
        if (this.said.has(responseId)) return 'again';
        const person = playerOf(responseId);
        if (person !== undefined && this.held.has(`${spaceName}\n${person}`)) return 'held';
        const words = this.wordsFor(reply);
        if (!words) return 'unsaid';
        // Someone is talking, or started to while this was being written: their turn wins and this is not said
        if (this.voice.someoneSpeaking(spaceName) || this.voice.lastSpokenToAt(spaceName) > at) {
            remember(this.said, responseId);
            return 'overtaken';
        }
        if (!this.voice.hasAudience(spaceName)) {
            this.waiting.set(spaceName, { responseId, text: words, since: this.now() });
            return 'waiting';
        }
        return this.speak(spaceName, responseId, words);
    }

    /** Someone's audio has just connected in this bubble: a reply that was waiting for it is said now, once. */
    audience(spaceName: string): void {
        const waiting = this.waiting.get(spaceName);
        if (!waiting) return;
        this.waiting.delete(spaceName);
        if (this.now() - waiting.since > this.limits.greetingWaitSeconds * 1000 || this.said.has(waiting.responseId)) return;
        if (this.voice.someoneSpeaking(spaceName)) {
            remember(this.said, waiting.responseId);
            return;
        }
        this.speak(spaceName, waiting.responseId, waiting.text);
    }

    /** The voice worker cut a segment short because someone spoke: which reply it was, if it is one of ours. */
    stopped(spaceName: string, segmentId: string): string | undefined {
        const segment = this.segments.get(segmentId);
        return segment && segment.spaceName === spaceName ? segment.responseId : undefined;
    }

    spaceLeft(spaceName: string): void {
        this.waiting.delete(spaceName);
        for (const key of this.held) if (key.startsWith(`${spaceName}\n`)) this.held.delete(key);
    }

    private wordsFor(reply: string): string {
        // A reply that still carries the "nothing was saved" line said it made something it did not: only the line is true
        if (reply.includes(NOTHING_SAVED_LINE)) return NOTHING_SAVED_LINE;
        return spokenVersion(reply, this.limits.maxChars);
    }

    private speak(spaceName: string, responseId: string, words: string): SpeechOutcome {
        const segmentId = `s${++this.seq}`;
        remember(this.said, responseId);
        if (!this.voice.say(spaceName, segmentId, words, Math.max(1000, this.limits.maxSeconds * 1000))) return 'unsaid';
        this.segments.set(segmentId, { spaceName, responseId });
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
