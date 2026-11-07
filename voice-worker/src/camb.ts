// Speaking with CAMB.AI (#1885), on the shared kit (#1883): one streamed request per reply to CAMB.AI's /apis/tts-stream, asking
// for raw s16 PCM so the audio plays as it arrives. The request is the one CAMB.AI's own SDK (camb-sdk 1.6.6) and Pipecat's
// CambTTSService send.
//
// The key goes in the x-api-key header of that one request and nowhere else. Each MARS model speaks at its own rate (Flash and
// Instruct 22.05 kHz, Pro 48 kHz), which is resampled to the worker's 24 kHz. CAMB.AI needs a language on every reply, from its
// own list of locales ("ar-kw", "en-us"): the reply's or the profile's when CAMB.AI has it, else that language's usual locale,
// else English. Voice ids are whole numbers.
import type { SpeechConnector, SpeechRequest } from './connectors.ts';
import { httpSpeech, type HttpSpeechSpec } from './kit/httpSpeech.ts';
import { baseLanguage } from './kit/signIn.ts';

export const CAMB_ADAPTER = 'camb';
export const CAMB_ENDPOINT = 'https://client.camb.ai/apis';
/** CAMB.AI's own default voice in Pipecat, used when no voice is picked. */
export const CAMB_DEFAULT_VOICE = 147320;
/** CAMB.AI's limit on one request's text. */
export const CAMB_MAX_TEXT = 3000;
/** The rate each model speaks at; a model not named here is taken to speak like Flash. */
const MODEL_RATES: Record<string, number> = { 'mars-flash': 22_050, 'mars-instruct': 22_050, 'mars-pro': 48_000 };
const DEFAULT_RATE = 22_050;

/** Every locale CAMB.AI's streaming speech takes (camb-sdk 1.6.6). */
const LOCALES = new Set(
    (
        'ar-ae ar-bh ar-dz ar-eg ar-iq ar-jo ar-kw ar-lb ar-ly ar-ma ar-om ar-qa ar-sa ar-sy ar-tn ar-xa ar-ye as-in bn-bd bn-in cs-cz ' +
        'de-at de-ch de-de el-gr en-au en-in en-uk en-us es-es es-mx es-us fi-fi fr-be fr-ca fr-ch fr-fr hi-in id-id it-it ja-jp kn-in ' +
        'ko-kr ml-in mr-in nl-be nl-nl pa-in pl-pl pt-br pt-pt ro-ro ru-ru ta-in te-in th-th tr-tr uk-ua vi-vn zh-cn zh-hk zh-tw'
    ).split(' ')
);
/** The usual locale of a language CAMB.AI has in more than one place. */
const USUAL: Record<string, string> = { ar: 'ar-sa', bn: 'bn-in', de: 'de-de', en: 'en-us', es: 'es-es', fr: 'fr-fr', nl: 'nl-nl', pt: 'pt-pt', zh: 'zh-cn' };

/** The CAMB.AI locale for a language code or locale ("ar-KW" is "ar-kw", "ar" is "ar-sa", "en-GB" is "en-uk"). */
export function cambLocale(lang: string | undefined): string {
    if (!lang) return 'en-us';
    const asked = lang.toLowerCase().replace('_', '-').replace(/^en-gb$/, 'en-uk');
    if (LOCALES.has(asked)) return asked;
    const base = baseLanguage(asked);
    if (USUAL[base]) return USUAL[base];
    for (const locale of LOCALES) if (locale.startsWith(`${base}-`)) return locale;
    return 'en-us';
}

function voiceOf(voiceId: string): number {
    const id = Number(voiceId);
    return voiceId !== '' && Number.isSafeInteger(id) && id >= 0 ? id : CAMB_DEFAULT_VOICE;
}

function specAt(sampleRate: number): HttpSpeechSpec {
    return {
        adapter: CAMB_ADAPTER,
        endpoint: CAMB_ENDPOINT,
        // CAMB.AI's docs don't say whether raw PCM can start with a WAV header: one is skipped rather than played as a click
        audio: { kind: 'raw', sampleRate, mayStartWithWav: true },
        call: (request) => ({
            url: '/tts-stream',
            headers: { 'x-api-key': request.settings.key.reveal(), 'content-type': 'application/json' },
            body: JSON.stringify({
                text: request.text.slice(0, CAMB_MAX_TEXT),
                voice_id: voiceOf(request.settings.voiceId),
                language: cambLocale(request.lang || request.settings.language),
                speech_model: request.settings.model,
                output_configuration: { format: 'pcm_s16le' },
            }),
        }),
    };
}

export class CambSpeech implements SpeechConnector {
    private readonly byRate = new Map<number, SpeechConnector>();

    speak(request: SpeechRequest): AsyncIterable<Int16Array> {
        const rate = MODEL_RATES[request.settings.model] ?? DEFAULT_RATE;
        let connector = this.byRate.get(rate);
        if (!connector) {
            connector = httpSpeech(specAt(rate));
            this.byRate.set(rate, connector);
        }
        return connector.speak(request);
    }
}
