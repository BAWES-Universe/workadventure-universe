// Speaking with MiniMax (#1896), on the shared kit (#1883): one streamed request per reply to MiniMax's /v1/t2a_v2, as
// Pipecat's MiniMaxHttpTTSService does. https://platform.minimax.io/docs/api-reference/speech-t2a-http
//
// The key goes as a bearer in that one request and nowhere else. The answer is server-sent events: each data block holds hex
// s16 PCM at the rate asked for (24 kHz, the worker's own) in data.audio, and the block with data.status 2 is the whole reply
// again, which is left out (exclude_aggregated_audio asks MiniMax not to send it, and it is skipped if it comes anyway).
// MiniMax reports a refused call inside a 200 answer: base_resp.status_code says why.
import type { SpeechConnector, SpeechRequest } from './connectors.ts';
import { httpSpeech, SPEECH_RATE, type AudioFrame } from './kit/httpSpeech.ts';
import { baseLanguage } from './kit/signIn.ts';

export const MINIMAX_ADAPTER = 'minimax';
export const MINIMAX_ENDPOINT = 'https://api.minimax.io';

/** Pipecat's default model and voice, used when a bot names none. */
const DEFAULT_MODEL = 'speech-2.8-turbo';
const DEFAULT_VOICE = 'Calm_Woman';

/** MiniMax takes fewer than 10,000 characters a request. */
const MAX_TEXT = 9999;

/** The language names MiniMax is told to favour (Pipecat's list); any other is left to MiniMax. */
const LANGUAGES: Record<string, string> = {
    af: 'Afrikaans',
    ar: 'Arabic',
    bg: 'Bulgarian',
    ca: 'Catalan',
    cs: 'Czech',
    da: 'Danish',
    de: 'German',
    el: 'Greek',
    en: 'English',
    es: 'Spanish',
    fa: 'Persian',
    fi: 'Finnish',
    fil: 'Filipino',
    fr: 'French',
    he: 'Hebrew',
    hi: 'Hindi',
    hr: 'Croatian',
    hu: 'Hungarian',
    id: 'Indonesian',
    it: 'Italian',
    ja: 'Japanese',
    ko: 'Korean',
    ms: 'Malay',
    nb: 'Norwegian',
    nn: 'Nynorsk',
    nl: 'Dutch',
    pl: 'Polish',
    pt: 'Portuguese',
    ro: 'Romanian',
    ru: 'Russian',
    sk: 'Slovak',
    sl: 'Slovenian',
    sv: 'Swedish',
    ta: 'Tamil',
    th: 'Thai',
    tr: 'Turkish',
    uk: 'Ukrainian',
    vi: 'Vietnamese',
    yue: 'Chinese,Yue',
    zh: 'Chinese',
};

/** The language MiniMax is told to favour for a reply, or none. Chinese as spoken in Hong Kong or Macau is Cantonese. */
export function minimaxLanguage(language: string | undefined): string | undefined {
    if (!language) return undefined;
    if (/^zh[-_](HK|MO)$/i.test(language)) return LANGUAGES.yue;
    return LANGUAGES[baseLanguage(language)];
}

/** The status a MiniMax base_resp code reads as. */
function minimaxStatus(code: number): number | undefined {
    if (code === 1004 || code === 2049) return 401; // the key is wrong, or not a key MiniMax knows
    if (code === 1008) return 402; // out of balance
    if (code === 1002 || code === 1039) return 429; // too many calls or tokens
    if (code === 2013) return 400; // a setting MiniMax doesn't take
    return undefined;
}

interface MiniMaxAnswer {
    data?: { audio?: unknown; status?: unknown } | null;
    base_resp?: { status_code?: unknown } | null;
}

export class MiniMaxSpeech implements SpeechConnector {
    private readonly connector = httpSpeech({
        adapter: MINIMAX_ADAPTER,
        endpoint: MINIMAX_ENDPOINT,
        audio: {
            kind: 'lines',
            sampleRate: SPEECH_RATE,
            encoding: 'hex',
            read: (message: unknown): AudioFrame | undefined => {
                if (typeof message !== 'object' || message === null) return undefined;
                const answer = message as MiniMaxAnswer;
                const code = Number(answer.base_resp?.status_code ?? 0);
                if (code) return { error: { status: minimaxStatus(code) } };
                // Status 2 holds the whole reply again, already played piece by piece
                if (answer.data?.status === 2) return { done: true };
                const audio = answer.data?.audio;
                return typeof audio === 'string' && audio ? { audio } : undefined;
            },
        },
        call: (request: SpeechRequest) => {
            const language = minimaxLanguage(request.lang || request.settings.language);
            return {
                url: '/v1/t2a_v2',
                headers: { authorization: `Bearer ${request.settings.key.reveal()}`, 'content-type': 'application/json' },
                body: JSON.stringify({
                    model: request.settings.model || DEFAULT_MODEL,
                    text: request.text.slice(0, MAX_TEXT),
                    stream: true,
                    stream_options: { exclude_aggregated_audio: true },
                    voice_setting: { voice_id: request.settings.voiceId || DEFAULT_VOICE },
                    audio_setting: { format: 'pcm', sample_rate: SPEECH_RATE, channel: 1 },
                    ...(language ? { language_boost: language } : {}),
                }),
            };
        },
    });

    speak(request: SpeechRequest): AsyncIterable<Int16Array> {
        return this.connector.speak(request);
    }
}
