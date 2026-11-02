// Turns each person's permitted audio into what the bot server needs to show them: the words so far while they talk
// (a private draft), and how a stretch of speech ended. It plugs into the InputSink seam of transport.ts, one per session.
//
// A stretch of speech ends one of three ways, and only the first ever becomes a message:
//   final    the person paused and every word came through        -> user.turn "final"
//   lost     the words did not all come through (the connection dropped, the limit was reached, the voice was stopped,
//            the recognizer gave up, a hole in the audio)           -> user.turn "lost", with the words that did
//   cleared  nothing to keep (no words, or the person stopped being heard on purpose: muted, a mode that does not listen)
// Nothing here sends a partial command by itself: a lost stretch is only ever offered back to the person.
//
// Audio is held only as long as the recognizer needs it: a short run of quiet before the first word (so it is not
// clipped), then the stretch itself, passed straight on. None of it is stored.
import type { ProviderReporter } from './connectors.ts';
import type { Counters } from './counters.ts';
import type { Recognizer, RecognizerFactory } from './recognizer.ts';
import type { OutgoingMessage } from './session.ts';
import type { InputFrame, InputSink } from './transport.ts';

/** Quiet this long ends a stretch of speech. */
export const DEFAULT_PAUSE_MS = 800;
/** Louder than this (RMS of 16-bit samples, about -40 dBFS) counts as speech. A provider's own detection replaces it. */
const SPEECH_RMS = 300;
/** Quiet kept before the first word. */
const PREROLL_MS = 200;
/** Audio missing from the middle of a stretch, in all, beyond which its words are not trusted to be complete. */
const GAP_LOSS_MS = 400;
/** Voiced audio this long in a stretch is a person speaking over the bot (it does not count a cough or a click). */
export const DEFAULT_BARGE_IN_MS = 100;
/** The schema's limit on the words of one stretch. */
export const MAX_TEXT_CHARS = 8000;

export type LostReason = 'cap' | 'gap' | 'path' | 'stopped' | 'provider';

export interface RecognitionOptions {
    factory: RecognizerFactory;
    /** The longest stretch of speech taken, in audio milliseconds, pre-roll included. Past it the words are only offered back. */
    maxUtteranceMs: number;
    pauseMs?: number;
    /** Voiced audio, in all, before a stretch of speech counts as speaking over the bot. Default: DEFAULT_BARGE_IN_MS. */
    bargeInMs?: number;
    /** A person is speaking (not just a sound): called once per stretch, as soon as it is clear. Local, no recognizer involved. */
    onSpeaking?(participantId: string): void;
    /** No audio at all this long while someone is speaking counts as a pause too (a sender that sends nothing while silent). Default: the pause. */
    idleMs?: number;
    counters: Counters;
    send(message: OutgoingMessage): void;
    /** Told how each stretch went at the provider: answered, or gave up. Absent for the built-in test engine. */
    provider?: ProviderReporter;
    /** Where the audio goes on to besides recognition (the worker-wide tap). */
    next?: InputSink;
}

interface Turn {
    id: string;
    recognizer: Recognizer;
    audioMs: number;
    quietMs: number;
    gapMs: number;
    /** Voiced audio so far, and whether the stretch has been called speech yet. */
    voicedMs: number;
    speaking: boolean;
    /** user.speech_started has gone out: only once it is speech (or words came through), never for a click or a cough. */
    announced: boolean;
    /** The last words heard. */
    text: string;
    /** Said its last (final, lost or cleared): anything later from the recognizer is ignored. */
    over: boolean;
    /** When the last audio arrived, and the timer that ends the stretch if no more does. */
    lastAt: number;
    timer?: NodeJS.Timeout;
}

interface Person {
    epoch: number;
    /** The stretch being spoken now. */
    speaking?: Turn;
    /** Every stretch not over yet, this one and any waiting for its final words. */
    open: Set<Turn>;
    /** After a limit or a failure: nothing is taken until they pause, so one long breath is not cut into many. */
    waitForPause: boolean;
    quietMs: number;
    preroll: Int16Array[];
    prerollMs: number;
}

const clip = (text: string): string => (text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text).trim();

function rms(pcm: Int16Array): number {
    let sum = 0;
    for (const v of pcm) sum += v * v;
    return Math.sqrt(sum / Math.max(1, pcm.length));
}

export class Recognition {
    private readonly people = new Map<string, Person>();
    private readonly pauseMs: number;
    private readonly idleMs: number;
    private seq = 0;
    private disposed = false;

    constructor(private readonly options: RecognitionOptions) {
        this.pauseMs = options.pauseMs ?? DEFAULT_PAUSE_MS;
        this.idleMs = options.idleMs ?? this.pauseMs;
    }

    /** The InputSink of the session: lanes and the room give their permitted audio to this. */
    readonly sink: InputSink = (frame) => {
        this.options.next?.(frame);
        this.hear(frame);
    };

    private hear(frame: InputFrame): void {
        if (this.disposed) return;
        const c = this.options.counters;
        let person = this.people.get(frame.participantId);
        if (person && frame.epoch < person.epoch) {
            c.inc('speech_stale_dropped');
            return;
        }
        if (person && frame.epoch > person.epoch) {
            // A newer path: what was said on the old one is not carried over, only offered back
            this.end(person, 'lost', 'path', frame.participantId);
            person.epoch = frame.epoch;
        }
        if (!person) {
            person = { epoch: frame.epoch, open: new Set(), waitForPause: false, quietMs: 0, preroll: [], prerollMs: 0 };
            this.people.set(frame.participantId, person);
        }
        const ms = frame.pcm16k.length / 16;
        const voiced = rms(frame.pcm16k) >= SPEECH_RMS;

        if (person.waitForPause) {
            person.quietMs = voiced ? 0 : person.quietMs + ms;
            if (person.quietMs >= this.pauseMs) person.waitForPause = false;
            return;
        }

        let turn = person.speaking;
        if (!turn) {
            if (!voiced) {
                this.remember(person, frame.pcm16k, ms);
                return;
            }
            turn = this.begin(frame, person);
        }

        turn.lastAt = performance.now();
        turn.audioMs += ms;
        turn.gapMs += frame.droppedMs;
        turn.quietMs = voiced ? 0 : turn.quietMs + ms;
        c.inc('speech_ms', Math.round(ms));
        if (voiced) turn.voicedMs += ms;
        if (!turn.speaking && turn.voicedMs >= (this.options.bargeInMs ?? DEFAULT_BARGE_IN_MS)) {
            turn.speaking = true;
            this.announce(turn, frame.participantId, frame.epoch);
            this.options.onSpeaking?.(frame.participantId);
        }
        turn.recognizer.push(frame.pcm16k);
        if (turn.over) return;
        if (turn.audioMs >= this.options.maxUtteranceMs) {
            // The limit: the words so far are offered back, never sent, and nothing more is taken until a pause
            c.inc('speech_cap_hit');
            this.finishAs(person, turn, frame.participantId, 'lost', 'cap', turn.text);
            person.waitForPause = true;
            person.quietMs = 0;
        } else if (turn.quietMs >= this.pauseMs) {
            this.pause(person, turn);
        }
    }

    /** The person paused: no more audio is coming for this stretch, so its recognizer says the final words. */
    private pause(person: Person, turn: Turn): void {
        clearTimeout(turn.timer);
        if (person.speaking === turn) person.speaking = undefined;
        turn.recognizer.finish();
    }

    /** Ends a stretch no audio has come for in a while, as a pause. */
    private watch(person: Person, turn: Turn): void {
        const wait = this.idleMs - (performance.now() - turn.lastAt);
        turn.timer = setTimeout(() => {
            if (turn.over || person.speaking !== turn) return;
            if (performance.now() - turn.lastAt >= this.idleMs) this.pause(person, turn);
            else this.watch(person, turn);
        }, Math.max(1, wait));
        turn.timer.unref?.();
    }

    private remember(person: Person, pcm: Int16Array, ms: number): void {
        person.preroll.push(pcm.slice());
        person.prerollMs += ms;
        while (person.preroll.length > 1 && person.prerollMs - person.preroll[0].length / 16 >= PREROLL_MS) {
            person.prerollMs -= person.preroll.shift()!.length / 16;
        }
    }

    private begin(frame: InputFrame, person: Person): Turn {
        const id = `${frame.epoch}-${++this.seq}`;
        const turn: Turn = {
            id,
            recognizer: undefined as unknown as Recognizer,
            audioMs: 0,
            quietMs: 0,
            gapMs: 0,
            voicedMs: 0,
            speaking: false,
            announced: false,
            text: '',
            over: false,
            lastAt: performance.now(),
        };
        const participantId = frame.participantId;
        turn.recognizer = this.options.factory({
            partial: (text) => {
                if (turn.over || this.disposed) return;
                const words = clip(text);
                if (words === turn.text) return;
                turn.text = words;
                this.announce(turn, participantId, frame.epoch);
                this.options.send({ type: 'user.partial', participantId, epoch: frame.epoch, turnId: id, text: words });
            },
            final: (text) => {
                if (turn.over || this.disposed) return;
                this.options.provider?.ok();
                const words = clip(text) || turn.text;
                // A hole in the audio: the words are not trusted to be all there, so they are only offered back
                if (turn.gapMs >= GAP_LOSS_MS && words) this.finishAs(person, turn, participantId, 'lost', 'gap', words);
                else this.finishAs(person, turn, participantId, words ? 'final' : 'cleared', undefined, words);
            },
            failed: (text, failure) => {
                if (turn.over || this.disposed) return;
                this.options.provider?.failed(failure?.status);
                const stillTalking = person.speaking === turn;
                this.finishAs(person, turn, participantId, 'lost', 'provider', clip(text) || turn.text);
                // Still talking: the rest is not taken as a new stretch until they pause
                if (stillTalking) {
                    person.waitForPause = true;
                    person.quietMs = 0;
                }
            },
        });
        person.open.add(turn);
        person.speaking = turn;
        this.watch(person, turn);
        this.options.counters.inc('speech_turns');
        // The quiet just before the first word goes in first, so it is not clipped
        for (const quiet of person.preroll) {
            turn.audioMs += quiet.length / 16;
            turn.recognizer.push(quiet);
        }
        person.preroll = [];
        person.prerollMs = 0;
        return turn;
    }

    /** Tells the bot server someone is speaking, once per stretch. A short noise never gets this far, so it holds back no reply. */
    private announce(turn: Turn, participantId: string, epoch: number): void {
        if (turn.announced) return;
        turn.announced = true;
        this.options.send({ type: 'user.speech_started', participantId, epoch, turnId: turn.id });
    }

    /** Says how a stretch ended, once, and closes its recognizer. */
    private finishAs(person: Person, turn: Turn, participantId: string, outcome: 'final' | 'lost' | 'cleared', reason: LostReason | undefined, text: string): void {
        if (turn.over) return;
        turn.over = true;
        clearTimeout(turn.timer);
        person.open.delete(turn);
        if (person.speaking === turn) person.speaking = undefined;
        turn.recognizer.close();
        // Nothing to keep is nothing to offer back
        const kind = outcome === 'lost' && !text ? 'cleared' : outcome;
        this.options.counters.inc(`speech_${kind}`);
        this.options.send({
            type: 'user.turn',
            participantId,
            epoch: person.epoch,
            turnId: turn.id,
            outcome: kind,
            ...(kind === 'cleared' ? {} : { text }),
            ...(kind === 'lost' ? { reason } : {}),
            audioMs: Math.round(turn.audioMs),
        });
    }

    /** Ends every stretch of one person that is not over: lost keeps their words to offer back, cleared drops them. */
    private end(person: Person, outcome: 'lost' | 'cleared', reason: LostReason, participantId: string): void {
        for (const turn of [...person.open]) this.finishAs(person, turn, participantId, outcome, reason, turn.text);
        person.waitForPause = false;
        person.preroll = [];
        person.prerollMs = 0;
    }

    /** One person's connection ended (or is going to be replaced): their words are offered back. */
    interrupt(participantId: string, epoch: number, outcome: 'lost' | 'cleared', reason: LostReason = 'path'): void {
        const person = this.people.get(participantId);
        if (!person || person.epoch !== epoch) return;
        this.end(person, outcome, reason, participantId);
        this.people.delete(participantId);
    }

    /** The room closed: everyone heard through it. */
    interruptEpoch(epoch: number, outcome: 'lost' | 'cleared', reason: LostReason = 'path'): void {
        for (const [participantId, person] of [...this.people]) if (person.epoch === epoch) this.interrupt(participantId, epoch, outcome, reason);
    }

    /** Everyone: the voice was stopped for the whole bubble. */
    interruptAll(outcome: 'lost' | 'cleared', reason: LostReason): void {
        for (const [participantId, person] of [...this.people]) this.interrupt(participantId, person.epoch, outcome, reason);
    }

    /**
     * People who are no longer heard on purpose (muted, a mode that does not listen, no longer named): what they had
     * said so far goes nowhere, not even back to them. Anyone for whom `heard` is false.
     */
    forget(heard: (participantId: string) => boolean): void {
        for (const [participantId, person] of [...this.people]) if (!heard(participantId)) this.interrupt(participantId, person.epoch, 'cleared');
    }

    /** The session is over: recognizers are closed and nothing more is said. */
    dispose(): void {
        this.disposed = true;
        for (const person of this.people.values()) {
            for (const turn of person.open) {
                clearTimeout(turn.timer);
                turn.recognizer.close();
            }
        }
        this.people.clear();
    }
}
