// Listening with AssemblyAI (#1884), on the shared kit (#1883): AssemblyAI's Universal Streaming socket (/v3/ws), one per stretch
// of speech. The key goes in the Authorization header of that one connection, as it is (no "Bearer"), and nowhere else.
// https://www.assemblyai.com/docs/api-reference/streaming-api/streaming-api
//
// AssemblyAI tells the end of a turn itself (`end_of_turn`, from the words and how they were said), so that ends the stretch at
// once; quiet still ends it when AssemblyAI hasn't. Each Turn message holds the whole turn so far, so a finished turn is kept and
// the next one is added with a space. "Terminate" ends the audio: AssemblyAI sends the last words, then `Termination`.
import type { RecognitionConnector, RecognitionSettings } from './connectors.ts';
import { socketHearing, type HearingMessage } from './kit/socketHearing.ts';
import type { Recognizer, RecognizerEvents } from './recognizer.ts';

export const ASSEMBLYAI_ADAPTER = 'assemblyai';
export const ASSEMBLYAI_ENDPOINT = 'wss://streaming.assemblyai.com';
/** Quiet that still ends a stretch when AssemblyAI has not said the turn ended: as long as Deepgram's and Soniox's. */
export const ASSEMBLYAI_FALLBACK_PAUSE_MS = 1800;
/**
 * Audio goes in pieces of this much: AssemblyAI closes the stream on a piece under 20 ms or over 1000 ms (close 3007), and
 * recommends 50 to 100 ms. The worker's frames are smaller, so they are gathered here.
 */
export const ASSEMBLYAI_CHUNK_MS = 100;
/** The last piece, sent at the end of the audio, is made up to this with quiet when it is shorter. */
const MIN_CHUNK_MS = 50;
const SAMPLES_PER_MS = 16;

interface AssemblyAiAnswer {
    type?: unknown;
    transcript?: unknown;
    end_of_turn?: unknown;
    words?: unknown;
    error?: unknown;
}

/**
 * What AssemblyAI's reason for refusing or closing a stream means as a status, so a key that is wrong or out of funds is shown
 * as such (https://www.assemblyai.com/docs/streaming/common-session-errors-and-closures).
 */
export function assemblyAiStatus(reason: string): number | undefined {
    const text = reason.toLowerCase();
    if (text.includes('insufficient funds')) return 402;
    if (text.includes('too many concurrent sessions')) return 429;
    if (text.includes('invalid api key') || text.includes('missing authorization') || text.includes('api key is disabled')) return 401;
    return undefined;
}

/** The words of a turn so far: every word AssemblyAI has, final or not, else its transcript. */
function turnWords(answer: AssemblyAiAnswer): string {
    if (Array.isArray(answer.words) && answer.words.length > 0) {
        const words = answer.words.map((word: unknown) => (typeof word === 'object' && word !== null && typeof (word as { text?: unknown }).text === 'string' ? (word as { text: string }).text : ''));
        const joined = words.filter(Boolean).join(' ');
        if (joined) return joined;
    }
    return typeof answer.transcript === 'string' ? answer.transcript : '';
}

export class AssemblyAiRecognition implements RecognitionConnector {
    private readonly connector: RecognitionConnector;

    constructor(options: { finalTimeoutMs?: number } = {}) {
        this.connector = socketHearing({
            adapter: ASSEMBLYAI_ADAPTER,
            endpoint: ASSEMBLYAI_ENDPOINT,
            finalTimeoutMs: options.finalTimeoutMs,
            pauseMs: ASSEMBLYAI_FALLBACK_PAUSE_MS,
            connect: (settings: RecognitionSettings, base) => {
                const query = new URLSearchParams({ speech_model: settings.model, encoding: 'pcm_s16le', sample_rate: '16000' });
                return { url: `${base}/v3/ws?${query}`, headers: { Authorization: settings.key.reveal() } };
            },
            finish: () => [JSON.stringify({ type: 'Terminate' })],
            read: (data, isBinary): HearingMessage | undefined => {
                if (isBinary) return undefined;
                const answer = JSON.parse(data.toString()) as AssemblyAiAnswer;
                if (typeof answer !== 'object' || answer === null) return undefined;
                if (answer.type === 'Termination') return { finished: true };
                if (answer.type === 'Error') return { error: { status: typeof answer.error === 'string' ? assemblyAiStatus(answer.error) : undefined } };
                if (answer.type !== 'Turn') return undefined;
                const words = turnWords(answer);
                if (answer.end_of_turn === true) return words ? { committed: words, endpoint: true } : { endpoint: true };
                return { interim: words };
            },
            closed: (code, reason) => {
                // 1008: refused (the reason says why); 1011: AssemblyAI couldn't check the key. Anything else is a dropped stream.
                if (code === 1008 || code === 1011) return { error: { status: assemblyAiStatus(reason) } };
                return undefined;
            },
        });
    }

    listen(settings: RecognitionSettings, events: RecognizerEvents): Recognizer {
        return new Chunked(this.connector.listen(settings, events));
    }
}

/** Gathers the worker's small frames into pieces AssemblyAI takes, and sends what is left, made long enough, at the end. */
class Chunked implements Recognizer {
    private held: Int16Array[] = [];
    private heldSamples = 0;
    readonly pauseMs?: number;

    constructor(private readonly inner: Recognizer) {
        this.pauseMs = inner.pauseMs;
    }

    push(pcm16k: Int16Array): void {
        if (pcm16k.length === 0) return;
        // Copied: the caller may reuse its buffer
        this.held.push(Int16Array.from(pcm16k));
        this.heldSamples += pcm16k.length;
        const chunk = ASSEMBLYAI_CHUNK_MS * SAMPLES_PER_MS;
        while (this.heldSamples >= chunk) this.inner.push(this.take(chunk));
    }

    finish(): void {
        if (this.heldSamples > 0) {
            const rest = this.take(this.heldSamples);
            const min = MIN_CHUNK_MS * SAMPLES_PER_MS;
            if (rest.length < min) {
                const padded = new Int16Array(min);
                padded.set(rest);
                this.inner.push(padded);
            } else {
                this.inner.push(rest);
            }
        }
        this.inner.finish();
    }

    close(): void {
        this.held = [];
        this.heldSamples = 0;
        this.inner.close();
    }

    /** The first `samples` held, which may be more than one frame, or the end of one. */
    private take(samples: number): Int16Array {
        const out = new Int16Array(samples);
        let filled = 0;
        while (filled < samples) {
            const first = this.held[0];
            const need = samples - filled;
            if (first.length <= need) {
                out.set(first, filled);
                filled += first.length;
                this.held.shift();
            } else {
                out.set(first.subarray(0, need), filled);
                this.held[0] = first.subarray(need);
                filled += need;
            }
        }
        this.heldSamples -= samples;
        return out;
    }
}
