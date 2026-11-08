// Hearing and speaking with xAI's own speech to text and text to speech (#1907), on the shared kit (#1883), as Pipecat's
// XAISTTService and XAIHttpTTSService do. https://docs.x.ai/developers/model-capabilities/audio/voice
//
// xAI also talks live (src/xai.ts, #1910) under the same adapter: these connectors take only their own models, and
// src/kit/byModel.ts sends every other model to the talking one. The key goes as a bearer in each socket's opening request or
// each speaking request, and nowhere else.
//
// Hearing (wss://api.x.ai/v1/stt): 16 kHz PCM, the model, the language and interim words are set in the address. Audio waits
// for transcript.created, then goes as binary frames; audio.done ends it. Each transcript.partial is interim (is_final false), a
// locked chunk (is_final) or the whole utterance (speech_final, restating its chunks); transcript.done answers audio.done and
// the socket then closes. The docs don't say whether transcript.done restates the earlier utterances or holds only the rest,
// so either reading gives the same words.
//
// Speaking (POST https://api.x.ai/v1/tts): the text, the voice, the language and raw 24 kHz PCM; the answer is the audio itself.
import type { RecognitionConnector, RecognitionSettings, SpeechConnector, SpeechRequest } from './connectors.ts';
import { httpSpeech, SPEECH_RATE } from './kit/httpSpeech.ts';
import { pcmBytes } from './kit/pcm.ts';
import { baseLanguage } from './kit/signIn.ts';
import { socketHearing, type HearingMessage } from './kit/socketHearing.ts';
import type { Recognizer, RecognizerEvents } from './recognizer.ts';

export const XAI_VOICE_ADAPTER = 'xai';
export const XAI_HEARING_ENDPOINT = 'wss://api.x.ai';
export const XAI_SPEECH_ENDPOINT = 'https://api.x.ai';
const HEARING_MODEL = 'grok-voice-transcribe-2.0';
/** xAI's speaking takes no model: this id (Orbit's) only tells it apart from the talking models. */
const SPEECH_MODEL = 'grok-tts';
export const XAI_HEARING_MODELS: ReadonlySet<string> = new Set([HEARING_MODEL]);
export const XAI_SPEECH_MODELS: ReadonlySet<string> = new Set([SPEECH_MODEL]);
/** Pipecat's default voice. */
const DEFAULT_VOICE = 'eve';
/** xAI takes at most 60,000 characters a request. */
const MAX_TEXT = 60000;

/** The locales xAI speaks with a region (Pipecat's list); other languages go as their base code. */
const SPEAKS_WITH_REGION = new Set(['ar-EG', 'ar-SA', 'ar-AE', 'es-ES', 'es-MX', 'pt-BR', 'pt-PT']);
/** The Gulf, closest to xAI's UAE Arabic. */
const GULF = new Set(['AE', 'BH', 'KW', 'OM', 'QA']);

/** The language xAI speaks a reply in, or "auto" to let it tell from the text. */
export function xaiSpeechLanguage(language: string | undefined): string {
    if (!language) return 'auto';
    const [base, region = ''] = language.split(/[-_]/);
    const locale = `${base.toLowerCase()}-${region.toUpperCase()}`;
    if (SPEAKS_WITH_REGION.has(locale)) return locale;
    const lang = baseLanguage(language);
    if (lang === 'ar') return GULF.has(region.toUpperCase()) ? 'ar-AE' : 'ar-EG';
    if (lang === 'es') return 'es-ES';
    if (lang === 'pt') return 'pt-PT';
    return lang;
}

interface XaiAnswer {
    type?: unknown;
    text?: unknown;
    is_final?: unknown;
    speech_final?: unknown;
    message?: unknown;
    error?: unknown;
}

/** The status an xAI error reads as, from its words. */
function xaiStatus(answer: XaiAnswer): number | undefined {
    const text = `${typeof answer.message === 'string' ? answer.message : ''} ${JSON.stringify(answer.error ?? '')}`;
    if (/api.?key|unauthori[sz]ed|authenticat|invalid.?key/i.test(text)) return 401;
    if (/credit|billing|balance|payment|spending/i.test(text)) return 402;
    if (/permission|forbidden/i.test(text)) return 403;
    if (/rate.?limit|too many/i.test(text)) return 429;
    return undefined;
}

const join = (...parts: string[]) => parts.filter(Boolean).join(' ');
const plain = (text: string) => text.replace(/\s+/g, ' ').trim();

export class XaiTranscription implements RecognitionConnector {
    constructor(private readonly options: { finalTimeoutMs?: number } = {}) {}

    listen(settings: RecognitionSettings, events: RecognizerEvents): Recognizer {
        // Each stretch is one socket: its utterances and locked chunks are kept here and committed once, when it ends
        let utterances = '';
        let chunks = '';
        return socketHearing({
            adapter: XAI_VOICE_ADAPTER,
            endpoint: XAI_HEARING_ENDPOINT,
            finalTimeoutMs: this.options.finalTimeoutMs,
            connect: (settings: RecognitionSettings, base) => {
                const query = new URLSearchParams({
                    sample_rate: '16000',
                    encoding: 'pcm',
                    interim_results: 'true',
                    model: settings.model || HEARING_MODEL,
                    ...(settings.language ? { language: baseLanguage(settings.language) } : {}),
                });
                return { url: `${base.replace(/^http/, 'ws')}/v1/stt?${query}`, headers: { authorization: `Bearer ${settings.key.reveal()}` } };
            },
            readyFirst: true,
            frame: (pcm16k: Int16Array) => pcmBytes(pcm16k),
            finish: () => [JSON.stringify({ type: 'audio.done' })],
            closeIsFinished: true,
            read: (data, isBinary): HearingMessage | HearingMessage[] | undefined => {
                if (isBinary) return undefined;
                const answer = JSON.parse(data.toString()) as unknown;
                if (typeof answer !== 'object' || answer === null) return undefined;
                const event = answer as XaiAnswer;
                const text = typeof event.text === 'string' ? event.text.trim() : '';
                switch (event.type) {
                    case 'transcript.created':
                        return { ready: true };
                    case 'transcript.partial':
                        if (event.speech_final === true) {
                            // The whole utterance, its chunks included
                            utterances = join(utterances, text);
                            chunks = '';
                            return { interim: utterances };
                        }
                        if (event.is_final === true) {
                            chunks = join(chunks, text);
                            return { interim: join(utterances, chunks) };
                        }
                        return { interim: join(utterances, chunks, text) };
                    case 'transcript.done': {
                        const before = join(utterances, chunks);
                        // Either the whole stretch again or only what came after the last words already heard
                        const all = !text ? before : plain(text).toLowerCase().startsWith(plain(before).toLowerCase()) ? text : join(before, text);
                        utterances = '';
                        chunks = '';
                        return [all ? { committed: all } : { interim: '' }, { finished: true }];
                    }
                    case 'error':
                        return { error: { status: xaiStatus(event) } };
                    default:
                        return undefined;
                }
            },
        }).listen(settings, events);
    }
}

export class XaiTts implements SpeechConnector {
    private readonly connector = httpSpeech({
        adapter: XAI_VOICE_ADAPTER,
        endpoint: XAI_SPEECH_ENDPOINT,
        audio: { kind: 'raw', sampleRate: SPEECH_RATE },
        call: (request: SpeechRequest, base) => ({
            url: `${base.replace(/^ws/, 'http')}/v1/tts`,
            headers: { authorization: `Bearer ${request.settings.key.reveal()}`, 'content-type': 'application/json' },
            body: JSON.stringify({
                text: request.text.slice(0, MAX_TEXT),
                voice_id: request.settings.voiceId || DEFAULT_VOICE,
                language: xaiSpeechLanguage(request.lang || request.settings.language),
                output_format: { codec: 'pcm', sample_rate: SPEECH_RATE },
            }),
        }),
    });

    speak(request: SpeechRequest): AsyncIterable<Int16Array> {
        return this.connector.speak(request);
    }
}
