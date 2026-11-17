// Speaking with Gemini text to speech on the Gemini API (#1891), on the shared kit (#1883), as Pipecat's GeminiTTSService does
// with an API key. https://ai.google.dev/gemini-api/docs
//
// Google also talks live (src/google.ts, #1910) under the same adapter: this connector takes only its own models, and
// src/kit/byModel.ts sends every other model to the talking one. The key goes in the x-goog-api-key header of each request
// and nowhere else.
//
// One streamed request per reply (POST /v1beta/models/{model}:streamGenerateContent?alt=sse): the text as the one user part,
// audio as the only answer, the voice and the language. Each server-sent event holds base64 24 kHz s16 audio in a part's
// inlineData; Gemini 3.8 may put a WAV header first, which is skipped. Google answers a wrong key 400 (API_KEY_INVALID), which
// is read as the key being refused.
import type { SpeechConnector, SpeechRequest } from './connectors.ts';
import { httpSpeech, SPEECH_RATE, type AudioFrame } from './kit/httpSpeech.ts';

export const GEMINI_SPEECH_ADAPTER = 'google';
export const GEMINI_SPEECH_ENDPOINT = 'https://generativelanguage.googleapis.com';
const DEFAULT_MODEL = 'gemini-3.8-flash-tts';
export const GEMINI_SPEECH_MODELS: ReadonlySet<string> = new Set([DEFAULT_MODEL, 'gemini-3.8-flash-lite-tts']);
/** Pipecat's default voice. */
const DEFAULT_VOICE = 'Kore';

/**
 * The locale Gemini speaks each language in when no region is named, as Pipecat's language_to_gemini_tts_language has it
 * (https://docs.cloud.google.com/text-to-speech/docs/gemini-tts#available_languages). Gemini takes locales, not bare codes.
 */
const LOCALES: Record<string, string> = {
    af: 'af-ZA', am: 'am-ET', ar: 'ar-EG', az: 'az-AZ', be: 'be-BY', bg: 'bg-BG', bn: 'bn-BD', ca: 'ca-ES', ceb: 'ceb-PH',
    cs: 'cs-CZ', da: 'da-DK', de: 'de-DE', el: 'el-GR', en: 'en-US', es: 'es-ES', et: 'et-EE', eu: 'eu-ES', fa: 'fa-IR',
    fi: 'fi-FI', fil: 'fil-PH', fr: 'fr-FR', gl: 'gl-ES', gu: 'gu-IN', he: 'he-IL', hi: 'hi-IN', hr: 'hr-HR', ht: 'ht-HT',
    hu: 'hu-HU', hy: 'hy-AM', id: 'id-ID', is: 'is-IS', it: 'it-IT', ja: 'ja-JP', jv: 'jv-JV', ka: 'ka-GE', kn: 'kn-IN',
    ko: 'ko-KR', kok: 'kok-IN', la: 'la-VA', lb: 'lb-LU', lo: 'lo-LA', lt: 'lt-LT', lv: 'lv-LV', mai: 'mai-IN', mg: 'mg-MG',
    mk: 'mk-MK', ml: 'ml-IN', mn: 'mn-MN', mr: 'mr-IN', ms: 'ms-MY', my: 'my-MM', nb: 'nb-NO', ne: 'ne-NP', nl: 'nl-NL',
    nn: 'nn-NO', no: 'nb-NO', or: 'or-IN', pa: 'pa-IN', pl: 'pl-PL', ps: 'ps-AF', pt: 'pt-BR', ro: 'ro-RO', ru: 'ru-RU',
    sd: 'sd-IN', si: 'si-LK', sk: 'sk-SK', sl: 'sl-SI', sq: 'sq-AL', sr: 'sr-RS', sv: 'sv-SE', sw: 'sw-KE', ta: 'ta-IN',
    te: 'te-IN', th: 'th-TH', tl: 'fil-PH', tr: 'tr-TR', uk: 'uk-UA', ur: 'ur-PK', vi: 'vi-VN', zh: 'cmn-CN',
};

/** The locale Gemini is told to speak in, as BCP-47, or none: then it tells from the text. */
export function geminiLanguage(language: string | undefined): string | undefined {
    if (!language) return undefined;
    const [first, ...rest] = language.split(/[-_]/);
    const base = first.toLowerCase();
    // A region, not a script (zh-Hant): two letters or three digits (es-419)
    const region = rest.find((part) => /^([a-z]{2}|\d{3})$/i.test(part))?.toUpperCase();
    // Gemini speaks Chinese as Mandarin, by region
    if (base === 'zh') return region === 'TW' || region === 'HK' || /hant/i.test(language) ? 'cmn-TW' : 'cmn-CN';
    if (region) return `${base}-${region}`;
    // A bare code Gemini has no locale for is left out rather than refused
    return LOCALES[base];
}

interface GeminiAnswer {
    candidates?: { content?: { parts?: { inlineData?: { data?: unknown } }[] } }[];
    error?: { code?: unknown; status?: unknown; message?: unknown };
}

/** Google's word for a wrong key, inside its 400 answer. */
export const geminiWrongKey = (status: number, body: string): boolean => status === 400 && body.includes('API_KEY_INVALID');

export class GeminiSpeech implements SpeechConnector {
    private readonly connector = httpSpeech({
        adapter: GEMINI_SPEECH_ADAPTER,
        endpoint: GEMINI_SPEECH_ENDPOINT,
        wrongKey: geminiWrongKey,
        audio: {
            kind: 'lines',
            sampleRate: SPEECH_RATE,
            encoding: 'base64',
            mayStartWithWav: true,
            read: (message: unknown): AudioFrame | undefined => {
                if (typeof message !== 'object' || message === null) return undefined;
                const answer = message as GeminiAnswer;
                if (answer.error) {
                    if (geminiWrongKey(Number(answer.error.code), JSON.stringify(answer.error))) return { error: { status: 401 } };
                    const code = Number(answer.error.code);
                    return { error: { status: Number.isInteger(code) && code >= 400 && code < 600 ? code : undefined } };
                }
                const audio = (answer.candidates?.[0]?.content?.parts ?? [])
                    .map((part) => part.inlineData?.data)
                    .filter((data): data is string => typeof data === 'string' && data.length > 0);
                if (audio.length < 2) return audio.length ? { audio: audio[0] } : undefined;
                // Each part is its own base64, so several are joined as bytes
                return { audio: Buffer.concat(audio.map((data) => Buffer.from(data, 'base64'))).toString('base64') };
            },
        },
        call: (request: SpeechRequest) => {
            const model = request.settings.model || DEFAULT_MODEL;
            const language = geminiLanguage(request.lang || request.settings.language);
            return {
                url: `/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
                headers: { 'x-goog-api-key': request.settings.key.reveal(), 'content-type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ role: 'user', parts: [{ text: request.text }] }],
                    generationConfig: {
                        responseModalities: ['AUDIO'],
                        speechConfig: {
                            ...(language ? { languageCode: language } : {}),
                            voiceConfig: { prebuiltVoiceConfig: { voiceName: request.settings.voiceId || DEFAULT_VOICE } },
                        },
                    },
                }),
            };
        },
    });

    speak(request: SpeechRequest): AsyncIterable<Int16Array> {
        return this.connector.speak(request);
    }
}
