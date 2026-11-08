// Hearing and speaking with Gradium (#1885), on the shared kit (#1883), as Pipecat's Gradium services do. Both are Gradium's
// sockets, one per stretch of speech or reply, with the key in the x-api-key header of that one connection and nowhere else.
// https://docs.gradium.ai/api-reference/endpoint/stt-websocket and .../tts-websocket
//
// Hearing: a setup message (model, 16 kHz s16 audio, language), then audio as base64 pieces. Gradium sends the words as text
// segments; "end_of_stream" ends the audio, and Gradium sends the last words and its own "end_of_stream".
// Speaking: a setup message (model, voice, raw 24 kHz s16 audio), the whole text, then "end_of_stream"; audio comes back as
// base64 pieces, and Gradium's "end_of_stream" ends the reply.
// A failure is an "error" message with a close code (1008: a refused key or setup), then the socket closes.
// Gradium speaks and hears English, French, German, Spanish and Portuguese; any other language is left for it to work out.
import type { RecognitionConnector, RecognitionSettings, SpeechConnector, SpeechRequest } from './connectors.ts';
import { pcmBytes } from './kit/pcm.ts';
import { baseLanguage } from './kit/signIn.ts';
import { socketHearing, type HearingMessage } from './kit/socketHearing.ts';
import { socketSpeech, type SpeechMessage } from './kit/socketSpeech.ts';
import type { Recognizer, RecognizerEvents } from './recognizer.ts';

export const GRADIUM_ADAPTER = 'gradium';
export const GRADIUM_HEARING_ENDPOINT = 'wss://api.gradium.ai/api/speech/asr';
export const GRADIUM_SPEECH_ENDPOINT = 'wss://api.gradium.ai/api/speech/tts';
/** A Gradium library voice, Pipecat's default, used when none is picked. */
export const GRADIUM_DEFAULT_VOICE = '_6Aslh2DxfmnRLmP';
const LANGUAGES = new Set(['en', 'fr', 'de', 'es', 'pt']);

interface GradiumAnswer {
    type?: unknown;
    text?: unknown;
    audio?: unknown;
    message?: unknown;
}

/** The language Gradium hears: the profile's when Gradium has it, else "any" (Gradium works it out). */
export const gradiumLanguage = (language: string | undefined): string => {
    const base = language ? baseLanguage(language) : '';
    return LANGUAGES.has(base) ? base : 'any';
};

/** What Gradium's error means as a status: a refused key is shown as such. */
function gradiumStatus(message: unknown): number | undefined {
    const text = typeof message === 'string' ? message.toLowerCase() : '';
    if (/api key|api_key|unauthori[sz]ed|authenticat/.test(text)) return 401;
    if (/credit|quota|balance|payment/.test(text)) return 402;
    if (/rate limit|too many|concurren/.test(text)) return 429;
    return undefined;
}

function parse(data: Buffer, isBinary: boolean): GradiumAnswer | undefined {
    if (isBinary) return undefined;
    const answer = JSON.parse(data.toString()) as GradiumAnswer;
    return typeof answer === 'object' && answer !== null ? answer : undefined;
}

export class GradiumRecognition implements RecognitionConnector {
    private readonly connector: RecognitionConnector;

    constructor(options: { finalTimeoutMs?: number } = {}) {
        this.connector = socketHearing({
            adapter: GRADIUM_ADAPTER,
            endpoint: GRADIUM_HEARING_ENDPOINT,
            finalTimeoutMs: options.finalTimeoutMs,
            connect: (settings: RecognitionSettings, base) => ({ url: base, headers: { 'x-api-key': settings.key.reveal() } }),
            start: (settings) => [
                JSON.stringify({ type: 'setup', model_name: settings.model, input_format: 'pcm_16000', json_config: { language: gradiumLanguage(settings.language) } }),
            ],
            frame: (pcm16k) => JSON.stringify({ type: 'audio', audio: pcmBytes(pcm16k).toString('base64') }),
            finish: () => [JSON.stringify({ type: 'end_of_stream' })],
            closeIsFinished: true,
            // Only a normal close ends with the last words: any other close (a dropped line, an error code) is a failure
            closed: (code) => (code === 1000 ? undefined : { error: {} }),
            read: (data, isBinary): HearingMessage | undefined => {
                const answer = parse(data, isBinary);
                if (!answer) return undefined;
                if (answer.type === 'end_of_stream') return { finished: true };
                if (answer.type === 'error') return { error: { status: gradiumStatus(answer.message) } };
                if (answer.type === 'text' && typeof answer.text === 'string' && answer.text.trim()) return { committed: answer.text.trim() };
                return undefined;
            },
        });
    }

    listen(settings: RecognitionSettings, events: RecognizerEvents): Recognizer {
        return this.connector.listen(settings, events);
    }
}

export class GradiumSpeech implements SpeechConnector {
    private readonly connector = socketSpeech({
        adapter: GRADIUM_ADAPTER,
        endpoint: GRADIUM_SPEECH_ENDPOINT,
        audio: { sampleRate: 24_000, encoding: 'base64' },
        connect: (request, base) => ({ url: base, headers: { 'x-api-key': request.settings.key.reveal() } }),
        send: (request: SpeechRequest) => [
            JSON.stringify({ type: 'setup', model_name: request.settings.model, voice_id: request.settings.voiceId || GRADIUM_DEFAULT_VOICE, output_format: 'pcm_24000' }),
            JSON.stringify({ type: 'text', text: request.text }),
            JSON.stringify({ type: 'end_of_stream' }),
        ],
        read: (data, isBinary): SpeechMessage | undefined => {
            const answer = parse(data, isBinary);
            if (!answer) return undefined;
            if (answer.type === 'error') return { error: { status: gradiumStatus(answer.message) } };
            if (answer.type === 'end_of_stream') return { done: true };
            if (answer.type === 'audio' && typeof answer.audio === 'string' && answer.audio) return { audio: answer.audio };
            return undefined;
        },
    });

    speak(request: SpeechRequest): AsyncIterable<Int16Array> {
        return this.connector.speak(request);
    }
}
