// Hearing and speaking with Together AI (#1906), on the shared kit (#1883). https://docs.together.ai
//
// The key goes as a bearer in each socket's opening request or each speaking request, and nowhere else.
//
// Hearing (Whisper Large v3, wss://api.together.ai/v1/realtime), as Pipecat's TogetherSTTService does: the model and
// pcm_s16le_16000 in the address, Together's own turn detection off. Audio goes as base64 in input_audio_buffer.append messages;
// input_audio_buffer.commit ends it, and Together answers with the stretch's whole transcript in one completed event. Each
// delta holds the words so far, replacing the last.
//
// Speaking (POST /v1/audio/speech, streamed): raw s16 24 kHz audio as server-sent events, each holding base64 audio in "b64",
// until [DONE]. Pipecat speaks over Together's socket; one request per reply is the same voices and models, and ends cleanly
// even when Together splits a long reply into several pieces.
import type { RecognitionConnector, RecognitionSettings, SpeechConnector, SpeechRequest } from './connectors.ts';
import { httpSpeech, SPEECH_RATE, type AudioFrame } from './kit/httpSpeech.ts';
import { pcmBytes } from './kit/pcm.ts';
import { baseLanguage } from './kit/signIn.ts';
import { socketHearing, type HearingMessage } from './kit/socketHearing.ts';
import type { Recognizer, RecognizerEvents } from './recognizer.ts';

export const TOGETHER_ADAPTER = 'together';
export const TOGETHER_ENDPOINT = 'wss://api.together.ai';
export const TOGETHER_SPEECH_ENDPOINT = 'https://api.together.ai';
const HEARING_MODEL = 'openai/whisper-large-v3';
const SPEECH_MODEL = 'hexgrad/Kokoro-82M';
/** Each model's default voice: Pipecat's for Kokoro, Together's for Orpheus. */
const DEFAULT_VOICES: Record<string, string> = { 'hexgrad/Kokoro-82M': 'af_heart', 'canopylabs/orpheus-3b-0.1-ft': 'tara' };

/** The languages Together is told to speak (Pipecat's list); any other is left to Together, which speaks English. */
const SPEAKS = new Set(['en', 'es', 'fr', 'hi', 'it', 'ja', 'pt', 'zh']);

/** The language Together is told to speak, or undefined. Hong Kong Chinese is "zh-hk". */
export function togetherLanguage(language: string | undefined): string | undefined {
    if (!language) return undefined;
    if (/^zh-hk$/i.test(language)) return 'zh-hk';
    const base = baseLanguage(language);
    return SPEAKS.has(base) ? base : undefined;
}

interface TogetherAnswer {
    type?: unknown;
    delta?: unknown;
    transcript?: unknown;
    error?: { code?: unknown; type?: unknown; message?: unknown } | unknown;
    message?: unknown;
}

/** The status a Together error reads as, from its code or words. */
function togetherStatus(answer: TogetherAnswer): number | undefined {
    const error = typeof answer.error === 'object' && answer.error !== null ? (answer.error as Record<string, unknown>) : {};
    const code = Number(error.code);
    if (Number.isInteger(code) && code >= 400 && code < 600) return code;
    const text = `${String(error.code ?? '')} ${String(error.type ?? '')} ${String(error.message ?? '')} ${typeof answer.message === 'string' ? answer.message : ''}`;
    // First: a rate limit's words can name the key or the quota it counts against
    if (/rate.?limit/i.test(text)) return 429;
    if (/api.?key|unauthori[sz]ed|authentication/i.test(text)) return 401;
    if (/credit|quota|balance|payment/i.test(text)) return 402;
    return undefined;
}

export class TogetherRecognition implements RecognitionConnector {
    constructor(private readonly options: { finalTimeoutMs?: number } = {}) {}

    listen(settings: RecognitionSettings, events: RecognizerEvents): Recognizer {
        // Only the transcript that answers the end of the audio ends the stretch
        let finishing = false;
        return socketHearing({
            adapter: TOGETHER_ADAPTER,
            endpoint: TOGETHER_ENDPOINT,
            finalTimeoutMs: this.options.finalTimeoutMs,
            connect: (settings: RecognitionSettings, base) => {
                const query = new URLSearchParams({
                    intent: 'transcription',
                    model: settings.model || HEARING_MODEL,
                    turn_detection: 'none',
                    input_audio_format: 'pcm_s16le_16000',
                });
                return { url: `${base}/v1/realtime?${query}`, headers: { authorization: `Bearer ${settings.key.reveal()}` } };
            },
            frame: (pcm16k: Int16Array) => JSON.stringify({ type: 'input_audio_buffer.append', audio: pcmBytes(pcm16k).toString('base64') }),
            finish: () => {
                finishing = true;
                return [JSON.stringify({ type: 'input_audio_buffer.commit' })];
            },
            read: (data, isBinary): HearingMessage | HearingMessage[] | undefined => {
                if (isBinary) return undefined;
                const answer = JSON.parse(data.toString()) as unknown;
                if (typeof answer !== 'object' || answer === null) return undefined;
                const event = answer as TogetherAnswer;
                switch (event.type) {
                    case 'conversation.item.input_audio_transcription.delta': {
                        // Together's docs name the field "delta", Pipecat reads "transcript": either holds the words so far
                        const text = typeof event.delta === 'string' ? event.delta : typeof event.transcript === 'string' ? event.transcript : '';
                        return { interim: text.trim() };
                    }
                    case 'conversation.item.input_audio_transcription.completed': {
                        const text = typeof event.transcript === 'string' ? event.transcript.trim() : '';
                        const words: HearingMessage = text ? { committed: text } : { interim: '' };
                        return finishing ? [words, { finished: true }] : words;
                    }
                    case 'conversation.item.input_audio_transcription.failed':
                    case 'error': {
                        // A commit with no audio (the stretch ended before any came) is nothing to hear, not a failure
                        const code = typeof event.error === 'object' && event.error !== null ? (event.error as { code?: unknown }).code : undefined;
                        if (code === 'input_audio_buffer_commit_empty') return finishing ? { finished: true } : undefined;
                        return { error: { status: togetherStatus(event) } };
                    }
                    default:
                        return undefined;
                }
            },
        }).listen(settings, events);
    }
}

export class TogetherSpeech implements SpeechConnector {
    private readonly connector = httpSpeech({
        adapter: TOGETHER_ADAPTER,
        endpoint: TOGETHER_SPEECH_ENDPOINT,
        audio: {
            kind: 'lines',
            sampleRate: SPEECH_RATE,
            encoding: 'base64',
            read: (message: unknown): AudioFrame | undefined => {
                if (typeof message !== 'object' || message === null) return undefined;
                const event = message as { b64?: unknown; error?: unknown };
                if (event.error !== undefined && event.error !== null) return { error: { status: togetherStatus(event as TogetherAnswer) } };
                return { audio: typeof event.b64 === 'string' && event.b64 ? event.b64 : undefined };
            },
        },
        call: (request: SpeechRequest) => {
            const model = request.settings.model || SPEECH_MODEL;
            const language = togetherLanguage(request.lang || request.settings.language);
            return {
                url: '/v1/audio/speech',
                headers: {
                    authorization: `Bearer ${request.settings.key.reveal()}`,
                    'content-type': 'application/json',
                },
                body: JSON.stringify({
                    model,
                    input: request.text,
                    voice: request.settings.voiceId || DEFAULT_VOICES[model] || DEFAULT_VOICES[SPEECH_MODEL],
                    response_format: 'raw',
                    response_encoding: 'pcm_s16le',
                    sample_rate: SPEECH_RATE,
                    stream: true,
                    ...(language ? { language } : {}),
                }),
            };
        },
    });

    speak(request: SpeechRequest): AsyncIterable<Int16Array> {
        return this.connector.speak(request);
    }
}
