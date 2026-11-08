// Hearing and speaking with Smallest AI (#1904), on the shared kit (#1883), over Smallest's sockets as Pipecat's SmallestSTTService
// and SmallestTTSService do. https://docs.smallest.ai
//
// The key goes as a bearer in each socket's opening request and nowhere else.
//
// Hearing (Pulse, wss://api.smallest.ai/waves/v1/stt/live): binary 16 kHz s16 audio. Each answer holds a transcript, settled
// when is_final says so. {"type":"close_stream"} ends the audio: Smallest sends the words it still holds, the last marked
// is_last, then closes the socket.
//
// Speaking (Lightning, wss://api.smallest.ai/waves/v1/tts/live): one message with the text, the voice, the model and the
// language. "chunk" answers hold base64 24 kHz s16 PCM, and "complete" says the reply is done.
import { randomUUID } from 'node:crypto';
import type { RecognitionConnector, RecognitionSettings, SpeechConnector, SpeechRequest } from './connectors.ts';
import { SPEECH_RATE } from './kit/httpSpeech.ts';
import { baseLanguage } from './kit/signIn.ts';
import { socketHearing, type HearingMessage } from './kit/socketHearing.ts';
import { socketSpeech, type SpeechMessage } from './kit/socketSpeech.ts';
import type { Recognizer, RecognizerEvents } from './recognizer.ts';

export const SMALLEST_ADAPTER = 'smallest';
export const SMALLEST_ENDPOINT = 'wss://api.smallest.ai';

/** The languages Pulse hears (Pipecat's list); any other is left to Smallest. */
const HEARS = new Set('bg bn cs da de en es et fi fr gu hi hu it kn lt lv ml mr mt nl or pa pl pt ro ru sk sv ta te uk'.split(' '));
/** The languages each Lightning model speaks (Smallest's docs); any other is "auto", for Smallest to work out. */
const SPEAKS: Record<string, Set<string>> = {
    'lightning_v3.1_pro': new Set('ar bn de el en es fi fr gu hi id it ja kn ko ml mr ms no or pa pl pt ru ta te tr vi zh'.split(' ')),
    'lightning_v3.1': new Set('bn en es gu hi kn ml mr or pa ta te'.split(' ')),
};
/** Each model's default voice, as Pipecat has them: a Lightning voice works only with its own model. */
const DEFAULT_VOICES: Record<string, string> = { 'lightning_v3.1_pro': 'meher', 'lightning_v3.1': 'sophia' };

/** The language Pulse is told to hear, or undefined. */
export function smallestHearing(language: string | undefined): string | undefined {
    const base = language ? baseLanguage(language) : '';
    return HEARS.has(base) ? base : undefined;
}

/** The language a Lightning model is told to speak. */
export function smallestSpeaking(model: string, language: string | undefined): string {
    const base = language ? baseLanguage(language) : '';
    return (SPEAKS[model] ?? SPEAKS['lightning_v3.1_pro']).has(base) ? base : 'auto';
}

interface SmallestAnswer {
    type?: unknown;
    status?: unknown;
    transcript?: unknown;
    is_final?: unknown;
    is_last?: unknown;
    error?: unknown;
    message?: unknown;
    code?: unknown;
    data?: { audio?: unknown };
}

function parse(data: Buffer): SmallestAnswer | undefined {
    const answer = JSON.parse(data.toString()) as unknown;
    return typeof answer === 'object' && answer !== null ? (answer as SmallestAnswer) : undefined;
}

/** The status a Smallest error reads as: its code when that is an HTTP one, and 401 for a key it won't take. */
function smallestStatus(answer: SmallestAnswer): number | undefined {
    const code = Number(answer.code);
    if (Number.isInteger(code) && code >= 400 && code < 600) return code;
    const text = `${JSON.stringify(answer.error ?? '')} ${typeof answer.message === 'string' ? answer.message : ''}`;
    return /api key|unauthori[sz]ed|forbidden|invalid token|authentication/i.test(text) ? 401 : undefined;
}

export class SmallestRecognition implements RecognitionConnector {
    private readonly connector: RecognitionConnector;

    constructor(options: { finalTimeoutMs?: number } = {}) {
        this.connector = socketHearing({
            adapter: SMALLEST_ADAPTER,
            endpoint: SMALLEST_ENDPOINT,
            finalTimeoutMs: options.finalTimeoutMs,
            connect: (settings: RecognitionSettings, base) => {
                const language = smallestHearing(settings.language);
                const query = new URLSearchParams({
                    model: settings.model,
                    ...(language ? { language } : {}),
                    encoding: 'linear16',
                    sample_rate: '16000',
                    format: 'true',
                });
                return { url: `${base}/waves/v1/stt/live?${query}`, headers: { authorization: `Bearer ${settings.key.reveal()}` } };
            },
            finish: () => [JSON.stringify({ type: 'close_stream' })],
            closeIsFinished: true,
            // Only a normal close ends with the last words: any other close is a failure
            closed: (code) => (code === 1000 ? undefined : { error: {} }),
            read: (data, isBinary): HearingMessage | HearingMessage[] | undefined => {
                if (isBinary) return undefined;
                const answer = parse(data);
                if (!answer) return undefined;
                if (answer.type === 'error' || (answer.error !== undefined && answer.error !== null)) return { error: { status: smallestStatus(answer) } };
                const out: HearingMessage[] = [];
                if (typeof answer.transcript === 'string') {
                    const text = answer.transcript.trim();
                    out.push(answer.is_final === true ? (text ? { committed: text } : { interim: '' }) : { interim: text });
                }
                if (answer.is_last === true) out.push({ finished: true });
                return out.length ? out : undefined;
            },
        });
    }

    listen(settings: RecognitionSettings, events: RecognizerEvents): Recognizer {
        return this.connector.listen(settings, events);
    }
}

export class SmallestSpeech implements SpeechConnector {
    private readonly connector = socketSpeech({
        adapter: SMALLEST_ADAPTER,
        endpoint: SMALLEST_ENDPOINT,
        connect: (request: SpeechRequest, base) => ({
            url: `${base}/waves/v1/tts/live`,
            headers: { authorization: `Bearer ${request.settings.key.reveal()}` },
        }),
        send: (request) => {
            const model = request.settings.model;
            return [
                JSON.stringify({
                    text: request.text,
                    // No voice picked: the model's default (a voice works only with its own model)
                    voice_id: request.settings.voiceId || DEFAULT_VOICES[model] || DEFAULT_VOICES['lightning_v3.1_pro'],
                    model,
                    language: smallestSpeaking(model, request.lang || request.settings.language),
                    sample_rate: SPEECH_RATE,
                    context_id: randomUUID(),
                    // The whole reply is in this one message
                    continue: false,
                    output_format: 'pcm',
                }),
            ];
        },
        audio: { sampleRate: SPEECH_RATE, encoding: 'base64' },
        read: (data, isBinary): SpeechMessage | undefined => {
            if (isBinary) return undefined;
            const answer = parse(data);
            if (answer?.status === 'chunk' && typeof answer.data?.audio === 'string' && answer.data.audio) return { audio: answer.data.audio };
            if (answer?.status === 'complete') return { done: true };
            if (answer?.status === 'error') return { error: { status: smallestStatus(answer) } };
            return undefined;
        },
    });

    speak(request: SpeechRequest): AsyncIterable<Int16Array> {
        return this.connector.speak(request);
    }
}
