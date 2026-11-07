// A speech server a person runs on their own computer (game #1874), reached through an https address such as a cloudflared
// tunnel: Speaches (Whisper hearing, Kokoro and Piper speaking), Kokoro-FastAPI, a Whisper of their own, anything that answers
// the OpenAI speech shape. Built on the shared kit (#1883).
//
// - Hearing: one upload per stretch of speech, sent when the person pauses, to `{address}/audio/transcriptions`. Nothing shows
//   while they talk (no live draft), the way Pipecat's BaseWhisperSTTService hears.
// - Speaking: one streamed request per reply to `{address}/audio/speech`, asking for raw `pcm`. The server's pcm is 24 kHz unless
//   its setting says another rate (VOICE_OPENAI_COMPATIBLE_SAMPLE_RATE); a WAV header in front is skipped.
// - Every call goes through the worker's address guard (kit/publicFetch.ts): the address is Orbit's `<origin>/v1`, typed by a
//   person, so it is checked public on every call and the connection goes to the address that was checked. The key is optional: with
//   none, no Authorization header is sent. It goes in that one header and nowhere else.
import type { RecognitionConnector, RecognitionSettings, SpeechConnector, SpeechRequest } from './connectors.ts';
import { httpSpeech, SPEECH_RATE, type FetchLike } from './kit/httpSpeech.ts';
import { publicFetch } from './kit/publicFetch.ts';
import { baseLanguage } from './kit/signIn.ts';
import { uploadHearing } from './kit/uploadHearing.ts';

export const OPENAI_COMPATIBLE_ADAPTER = 'openai-compatible';

export interface OpenAiCompatibleOptions {
    /** What makes the calls: the guarded fetch. Tests pass a stand-in. */
    fetch?: FetchLike;
    /** The sample rate of the server's `pcm`; OpenAI's, and the usual one, is 24 kHz. */
    sampleRate?: number;
}

/** The key as a header, only when the server has one. */
const authorization = (settings: Pick<RecognitionSettings, 'key'>): Record<string, string> => {
    const key = settings.key.reveal();
    return key ? { authorization: `Bearer ${key}` } : {};
};

export class OpenAiCompatibleSpeech implements SpeechConnector {
    private readonly connector: SpeechConnector;

    constructor(options: OpenAiCompatibleOptions = {}) {
        this.connector = httpSpeech({
            adapter: OPENAI_COMPATIBLE_ADAPTER,
            // The address is always the person's: there is no company default
            endpoint: '',
            fetch: options.fetch ?? publicFetch,
            audio: { kind: 'raw', sampleRate: options.sampleRate ?? SPEECH_RATE, mayStartWithWav: true },
            call: (request) => ({
                url: '/audio/speech',
                headers: { ...authorization(request.settings), 'content-type': 'application/json' },
                body: JSON.stringify({ model: request.settings.model, input: request.text, voice: request.settings.voiceId, response_format: 'pcm' }),
            }),
        });
    }

    speak(request: SpeechRequest): AsyncIterable<Int16Array> {
        return this.connector.speak(request);
    }
}

export class OpenAiCompatibleRecognition implements RecognitionConnector {
    private readonly connector: RecognitionConnector;

    constructor(options: Pick<OpenAiCompatibleOptions, 'fetch'> = {}) {
        this.connector = uploadHearing({
            adapter: OPENAI_COMPATIBLE_ADAPTER,
            endpoint: '',
            fetch: options.fetch ?? publicFetch,
            request: (settings, wav) => {
                const form = new FormData();
                form.set('file', new Blob([wav as BlobPart], { type: 'audio/wav' }), 'speech.wav');
                form.set('model', settings.model);
                form.set('response_format', 'json');
                // Whisper takes a base code such as `ar`; left out, the server finds the language itself
                if (settings.language) form.set('language', baseLanguage(settings.language));
                // The form sets its own content type, with the boundary
                return { url: '/audio/transcriptions', headers: authorization(settings), body: form };
            },
            read: (answer) => (typeof (answer as { text?: unknown })?.text === 'string' ? (answer as { text: string }).text : ''),
        });
    }

    listen: RecognitionConnector['listen'] = (settings, events) => this.connector.listen(settings, events);
}
