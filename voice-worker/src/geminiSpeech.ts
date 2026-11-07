// Speaking with Gemini text to speech on the Gemini API (#1891), on the shared kit (#1883), as Pipecat's GeminiTTSService does
// with an API key. https://ai.google.dev/gemini-api/docs
//
// Google also talks live (src/google.ts, #1910) under the same adapter: this connector takes only its own models, and
// src/kit/byModel.ts sends every other model to the talking one. The key goes in the x-goog-api-key header of each request
// and nowhere else.
//
// One streamed request per reply (POST /v1beta/models/{model}:streamGenerateContent?alt=sse): the text as the one user part,
// audio as the only answer, the voice and the language. Each server-sent event holds base64 24 kHz s16 audio in a part's
// inlineData; Gemini 3.8 may put a WAV header first, which is skipped. Google answers a wrong key 400 (API_KEY_INVALID).
import type { SpeechConnector, SpeechRequest } from './connectors.ts';
import { httpSpeech, SPEECH_RATE, type AudioFrame } from './kit/httpSpeech.ts';

export const GEMINI_SPEECH_ADAPTER = 'google';
export const GEMINI_SPEECH_ENDPOINT = 'https://generativelanguage.googleapis.com';
const DEFAULT_MODEL = 'gemini-3.8-flash-tts';
export const GEMINI_SPEECH_MODELS: ReadonlySet<string> = new Set([DEFAULT_MODEL, 'gemini-3.8-flash-lite-tts']);
/** Pipecat's default voice. */
const DEFAULT_VOICE = 'Kore';

/** The locale Gemini is told to speak in, as BCP-47, or none: then it tells from the text. */
export function geminiLanguage(language: string | undefined): string | undefined {
    if (!language) return undefined;
    const [base, region] = language.split(/[-_]/);
    return region ? `${base.toLowerCase()}-${region.toUpperCase()}` : base.toLowerCase();
}

interface GeminiAnswer {
    candidates?: { content?: { parts?: { inlineData?: { data?: unknown } }[] } }[];
    error?: { code?: unknown; status?: unknown; message?: unknown };
}

export class GeminiSpeech implements SpeechConnector {
    private readonly connector = httpSpeech({
        adapter: GEMINI_SPEECH_ADAPTER,
        endpoint: GEMINI_SPEECH_ENDPOINT,
        audio: {
            kind: 'lines',
            sampleRate: SPEECH_RATE,
            encoding: 'base64',
            mayStartWithWav: true,
            read: (message: unknown): AudioFrame | undefined => {
                if (typeof message !== 'object' || message === null) return undefined;
                const answer = message as GeminiAnswer;
                if (answer.error) {
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
