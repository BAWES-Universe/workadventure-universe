// Hearing and speaking with Sarvam AI (#1903), on the shared kit (#1883), over Sarvam's sockets as Pipecat's SarvamSTTService and
// SarvamTTSService do. Sarvam hears and speaks Indian languages and Indian English. https://docs.sarvam.ai
//
// The key goes in the api-subscription-key header of each socket and nowhere else.
//
// Hearing (wss://api.sarvam.ai/speech-to-text/ws): 16 kHz s16 audio goes as base64 in {"audio": {...}} messages. Sarvam answers
// each stretch it hears with one "data" message holding its words, and none that may still change. {"type":"flush"} ends the
// audio: Sarvam then sends the words it still holds, the last answer of the stretch. Its VAD signals ("events" START_SPEECH and
// END_SPEECH) count the speech it heard: once each start has its "data", a flush with nothing left to answer doesn't wait.
//
// Speaking (wss://api.sarvam.ai/text-to-speech/ws): a "config" message, the text, then "flush". "audio" messages hold base64
// 24 kHz s16 PCM, and an "event" of type "final" says the reply is complete.
import type { RecognitionConnector, RecognitionSettings, SpeechConnector, SpeechRequest } from './connectors.ts';
import { SPEECH_RATE } from './kit/httpSpeech.ts';
import { pcmBytes } from './kit/pcm.ts';
import { baseLanguage } from './kit/signIn.ts';
import { socketHearing, type HearingMessage } from './kit/socketHearing.ts';
import { socketSpeech, type SpeechMessage } from './kit/socketSpeech.ts';
import type { Recognizer, RecognizerEvents } from './recognizer.ts';

export const SARVAM_ADAPTER = 'sarvam';
export const SARVAM_ENDPOINT = 'wss://api.sarvam.ai';
/** How long the words still held may take after the end of the audio before the stretch ends with what was heard. */
export const SARVAM_LAST_WORDS_MS = 5_000;

/** The languages Sarvam speaks and hears (Pipecat's list), each as Sarvam names it: Indian, and Odia as "od". */
const LANGUAGES: Record<string, string> = {
    bn: 'bn-IN',
    en: 'en-IN',
    gu: 'gu-IN',
    hi: 'hi-IN',
    kn: 'kn-IN',
    ml: 'ml-IN',
    mr: 'mr-IN',
    or: 'od-IN',
    od: 'od-IN',
    pa: 'pa-IN',
    ta: 'ta-IN',
    te: 'te-IN',
};

/** Sarvam's code for a language it has, or undefined. */
export function sarvamLanguage(language: string | undefined): string | undefined {
    return language ? LANGUAGES[baseLanguage(language)] : undefined;
}

interface SarvamMessage {
    type?: unknown;
    data?: {
        signal_type?: unknown;
        transcript?: unknown;
        audio?: unknown;
        event_type?: unknown;
        error?: unknown;
        message?: unknown;
        code?: unknown;
    };
}

/** The status a Sarvam error reads as: its code when that is an HTTP one, and 401 for a key it won't take. */
function sarvamStatus(data: SarvamMessage['data']): number | undefined {
    const code = Number(data?.code);
    if (Number.isInteger(code) && code >= 400 && code < 600) return code;
    const text = `${typeof data?.error === 'string' ? data.error : ''} ${typeof data?.message === 'string' ? data.message : ''}`;
    return /subscription|api key|unauthori[sz]ed|forbidden|invalid key/i.test(text) ? 401 : undefined;
}

function parse(data: Buffer): SarvamMessage | undefined {
    const message = JSON.parse(data.toString()) as unknown;
    return typeof message === 'object' && message !== null ? (message as SarvamMessage) : undefined;
}

export class SarvamRecognition implements RecognitionConnector {
    private readonly connector: RecognitionConnector;

    constructor(options: { lastWordsMs?: number } = {}) {
        this.connector = socketHearing({
            adapter: SARVAM_ADAPTER,
            endpoint: SARVAM_ENDPOINT,
            connect: (settings: RecognitionSettings, base) => {
                const query = new URLSearchParams({
                    model: settings.model,
                    // A language Sarvam doesn't have is left for it to work out
                    'language-code': sarvamLanguage(settings.language) ?? 'unknown',
                    sample_rate: '16000',
                    input_audio_codec: 'pcm_s16le',
                    flush_signal: 'true',
                    vad_signals: 'true',
                });
                return {
                    url: `${base}/speech-to-text/ws?${query}`,
                    headers: { 'api-subscription-key': settings.key.reveal() },
                };
            },
            frame: (pcm16k) =>
                JSON.stringify({
                    audio: {
                        data: pcmBytes(pcm16k).toString('base64'),
                        sample_rate: 16_000,
                        encoding: 'audio/wav',
                    },
                }),
            finish: () => [JSON.stringify({ type: 'flush' })],
            lastAnswerAfterFinish: { quietMs: options.lastWordsMs ?? SARVAM_LAST_WORDS_MS },
            read: (data, isBinary): HearingMessage | undefined => {
                if (isBinary) return undefined;
                const message = parse(data);
                if (message?.type === 'error') return { error: { status: sarvamStatus(message.data) } };
                // Speech Sarvam heard and has not answered yet; its answer comes as the next "data"
                if (message?.type === 'events' && message.data?.signal_type === 'START_SPEECH') return { speech: 'started' };
                if (message?.type === 'data') {
                    const words = typeof message.data?.transcript === 'string' ? message.data.transcript.trim() : '';
                    return { committed: words, speech: 'answered' };
                }
                return undefined;
            },
        });
    }

    listen(settings: RecognitionSettings, events: RecognizerEvents): Recognizer {
        return this.connector.listen(settings, events);
    }
}

export class SarvamSpeech implements SpeechConnector {
    private readonly connector = socketSpeech({
        adapter: SARVAM_ADAPTER,
        endpoint: SARVAM_ENDPOINT,
        connect: (request: SpeechRequest, base) => ({
            url: `${base}/text-to-speech/ws?model=${encodeURIComponent(request.settings.model)}&send_completion_event=true`,
            headers: { 'api-subscription-key': request.settings.key.reveal() },
        }),
        send: (request) => {
            const speaker = request.settings.voiceId;
            return [
                JSON.stringify({
                    type: 'config',
                    data: {
                        // Sarvam needs a language it speaks: Indian English when the reply's language is not one of them
                        target_language_code: sarvamLanguage(request.lang || request.settings.language) ?? 'en-IN',
                        // No voice picked: Sarvam's own default for the model
                        ...(speaker ? { speaker } : {}),
                        speech_sample_rate: SPEECH_RATE,
                        enable_preprocessing: true,
                        output_audio_codec: 'linear16',
                        model: request.settings.model,
                    },
                }),
                JSON.stringify({ type: 'text', data: { text: request.text } }),
                JSON.stringify({ type: 'flush' }),
            ];
        },
        // Asked for raw PCM; a WAV header is skipped rather than played as a click if Sarvam sends one anyway
        audio: {
            sampleRate: SPEECH_RATE,
            encoding: 'base64',
            mayStartWithWav: true,
        },
        read: (data, isBinary): SpeechMessage | undefined => {
            if (isBinary) return undefined;
            const message = parse(data);
            if (message?.type === 'audio' && typeof message.data?.audio === 'string' && message.data.audio) return { audio: message.data.audio };
            if (message?.type === 'event' && message.data?.event_type === 'final') return { done: true };
            if (message?.type === 'error') return { error: { status: sarvamStatus(message.data) } };
            return undefined;
        },
    });

    speak(request: SpeechRequest): AsyncIterable<Int16Array> {
        return this.connector.speak(request);
    }
}
