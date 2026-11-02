// What a speech recognizer is to the worker, so a provider can be swapped in without touching anything else: one
// session per stretch of speech, fed the person's permitted audio, answering with words. Recognition.ts decides when
// a stretch starts and ends, enforces the limits and says what the words become. A recognizer is made per session by the
// connector its bubble names (connectors.ts); FakeEars stands in for one, with a script, so tests need no keys, no
// network and no spend.

/** What a recognizer says back. Words only: audio is never kept, here or by anything that gets it. */
export interface RecognizerEvents {
    /** All the words heard so far in this stretch of speech. Each replaces the one before it. */
    partial(text: string): void;
    /** Every word of the stretch, after `finish()`. */
    final(text: string): void;
    /**
     * The recognizer gave up part-way (dropped stream, refused, timed out) with the words it had. `status` is the
     * provider's HTTP status when it answered with one; leave it out for a timeout or a dropped connection.
     */
    failed(text: string, failure?: { status?: number }): void;
}

export interface Recognizer {
    /** The next audio of the stretch, 16 kHz mono, in order. */
    push(pcm16k: Int16Array): void;
    /** The person paused: no more audio is coming, so say the final words. */
    finish(): void;
    /** Throw everything away. Nothing is said after this. */
    close(): void;
}

/** One recognizer per stretch of speech. */
export type RecognizerFactory = (events: RecognizerEvents) => Recognizer;

export interface FakeUtterance {
    /** What the person is heard to say. */
    text: string;
    /** Audio milliseconds it takes for each word to show up in the partials. Default 300. */
    wordMs?: number;
    /** The stream drops once this many words have shown up, with those words (a lost connection to the provider). */
    failAfterWords?: number;
    /** Milliseconds between `finish()` and the final words. Default 0: at once. */
    finalDelayMs?: number;
}

/**
 * A deterministic stand-in for a provider. Its script is the words of each stretch of speech, in order: the first
 * stretch is the first entry, and so on. Words appear as audio arrives (one per `wordMs` of it), so what shows depends
 * on how long the person spoke and nothing else. A stretch beyond the script is heard as silence.
 */
export class FakeEars {
    private next = 0;
    /** Stretches of speech started, and audio milliseconds received, for tests to check. */
    started = 0;
    audioMs = 0;
    closed = 0;

    constructor(private readonly script: readonly (string | FakeUtterance)[]) {}

    readonly factory: RecognizerFactory = (events) => {
        this.started++;
        const entry = this.script[this.next++];
        const utterance: FakeUtterance = typeof entry === 'string' ? { text: entry } : entry ?? { text: '' };
        const words = utterance.text.split(/\s+/).filter(Boolean);
        const wordMs = utterance.wordMs ?? 300;
        let heardMs = 0;
        let shown = 0;
        let done = false;
        let cancelled = false;
        const said = (count: number): string => words.slice(0, count).join(' ');
        return {
            push: (pcm16k) => {
                if (done) return;
                const ms = pcm16k.length / 16;
                heardMs += ms;
                this.audioMs += ms;
                const reached = Math.min(words.length, Math.floor(heardMs / wordMs));
                if (reached > shown) {
                    shown = reached;
                    events.partial(said(shown));
                }
                if (utterance.failAfterWords !== undefined && shown >= utterance.failAfterWords) {
                    done = true;
                    events.failed(said(shown));
                }
            },
            finish: () => {
                if (done) return;
                done = true;
                const say = () => {
                    if (!cancelled) events.final(utterance.text);
                };
                if (utterance.finalDelayMs) setTimeout(say, utterance.finalDelayMs).unref?.();
                else say();
            },
            close: () => {
                done = true;
                cancelled = true;
                this.closed++;
            },
        };
    };
}
