// Speaking with Rime (#1902), on the shared kit (#1883): one streamed request per reply to Rime's /v1/rime-tts, the model named in
// the request, as Pipecat's RimeHttpTTSService does. https://docs.rime.ai
//
// The key goes as a bearer in that one request and nowhere else. The answer is raw 24 kHz s16 PCM, the worker's own rate. A Rime
// voice speaks one language, which the request names (Rime's three-letter code) when Rime has the reply's language.
import type { SpeechConnector, SpeechRequest } from './connectors.ts';
import { httpSpeech, SPEECH_RATE } from './kit/httpSpeech.ts';
import { baseLanguage } from './kit/signIn.ts';

export const RIME_ADAPTER = 'rime';
export const RIME_ENDPOINT = 'https://users.rime.ai';
/** Rime takes up to 1,000 characters a request. */
export const RIME_MAX_TEXT = 1_000;

/** Rime's codes for the languages it speaks (Pipecat's list). */
const LANGUAGES: Record<string, string> = {
    ar: 'ara',
    de: 'ger',
    en: 'eng',
    es: 'spa',
    fr: 'fra',
    hi: 'hin',
    it: 'ita',
    ja: 'jpn',
    pt: 'por',
};

/** Rime's code for a language, or undefined to leave it to the voice. */
export function rimeLanguage(language: string | undefined): string | undefined {
    return language ? LANGUAGES[baseLanguage(language)] : undefined;
}

export class RimeSpeech implements SpeechConnector {
    private readonly connector = httpSpeech({
        adapter: RIME_ADAPTER,
        endpoint: RIME_ENDPOINT,
        audio: { kind: 'raw', sampleRate: SPEECH_RATE },
        call: (request: SpeechRequest) => {
            const lang = rimeLanguage(request.lang || request.settings.language);
            const speaker = request.settings.voiceId;
            return {
                url: '/v1/rime-tts',
                headers: {
                    authorization: `Bearer ${request.settings.key.reveal()}`,
                    'content-type': 'application/json',
                    accept: 'audio/pcm',
                },
                body: JSON.stringify({
                    text: request.text.slice(0, RIME_MAX_TEXT),
                    // No voice picked: Rime's own choice
                    ...(speaker ? { speaker } : {}),
                    modelId: request.settings.model,
                    samplingRate: SPEECH_RATE,
                    ...(lang ? { lang } : {}),
                }),
            };
        },
    });

    speak(request: SpeechRequest): AsyncIterable<Int16Array> {
        return this.connector.speak(request);
    }
}
