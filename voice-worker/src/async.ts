// Speaking with Async (#1885), on the shared kit (#1883): Async's text-to-speech socket, one socket per reply.
// https://docs.async.com/text-to-speech-websocket-3477526w0
//
// Async takes the key only in the socket's address (`api_key`, with `version`), so it is there for that one connection and
// nowhere else; a failure never carries the address. The reply is one context: the setup (model, voice, raw 24 kHz s16 audio,
// language), then the whole text with `force`, so Async speaks it at once. Audio comes back as base64 pieces, and `final`
// ends the reply. A failure is a message with `error_code`, a word or a number, and `message`.
import type { SpeechConnector, SpeechRequest } from './connectors.ts';
import { SPEECH_RATE } from './kit/httpSpeech.ts';
import { baseLanguage } from './kit/signIn.ts';
import { socketSpeech, type SpeechMessage } from './kit/socketSpeech.ts';

export const ASYNC_ADAPTER = 'async';
export const ASYNC_ENDPOINT = 'wss://api.async.com/text_to_speech/websocket/ws';
export const ASYNC_API_VERSION = 'v1';
/** One reply is one context on its own socket, so its id never has to differ. */
const CONTEXT_ID = 'reply';

interface AsyncAnswer {
    audio?: unknown;
    final?: unknown;
    error_code?: unknown;
    message?: unknown;
}

/** What Async's error means as a status, so a refused key or an empty balance is shown as such. */
export function asyncStatus(code: unknown, message: unknown): number | undefined {
    if (typeof code === 'number' && Number.isInteger(code)) return code;
    const text = `${typeof code === 'string' ? code : ''} ${typeof message === 'string' ? message : ''}`.toLowerCase();
    const number = /\b([45]\d\d)\b/.exec(text);
    if (number) return Number(number[1]);
    if (/credit|balance|quota|payment|insufficient/.test(text)) return 402;
    if (/unauthori[sz]ed|api key|api_key|forbidden|authenticat/.test(text)) return 401;
    if (/rate limit|too many|concurren/.test(text)) return 429;
    return undefined;
}

export class AsyncSpeech implements SpeechConnector {
    private readonly connector = socketSpeech({
        adapter: ASYNC_ADAPTER,
        endpoint: ASYNC_ENDPOINT,
        audio: { sampleRate: SPEECH_RATE, encoding: 'base64' },
        connect: (request, base) => {
            const query = new URLSearchParams({ api_key: request.settings.key.reveal(), version: ASYNC_API_VERSION });
            return { url: `${base}?${query}` };
        },
        send: (request) => {
            const language = request.lang || request.settings.language;
            const setup = {
                model_id: request.settings.model,
                voice: { mode: 'id', id: request.settings.voiceId },
                output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: SPEECH_RATE },
                ...(language ? { language: baseLanguage(language) } : {}),
            };
            return [JSON.stringify(setup), JSON.stringify({ transcript: request.text, context_id: CONTEXT_ID, force: true })];
        },
        read: (data, isBinary): SpeechMessage | undefined => {
            if (isBinary) return undefined;
            const answer = JSON.parse(data.toString()) as AsyncAnswer;
            if (typeof answer !== 'object' || answer === null) return undefined;
            if (answer.error_code !== undefined && answer.error_code !== null) return { error: { status: asyncStatus(answer.error_code, answer.message) } };
            return { audio: typeof answer.audio === 'string' && answer.audio ? answer.audio : undefined, done: answer.final === true };
        },
    });

    speak(request: SpeechRequest): AsyncIterable<Int16Array> {
        return this.connector.speak(request);
    }
}
