// Hearing with Zoom's Scribe (#1908), on the shared kit (#1883), as Pipecat's ZoomAISTTService does with Pipecat's own turn
// detection. https://developers.zoom.us/docs/ai-services/scribe/
//
// Zoom also talks live (src/zoom.ts, #1910) under the same adapter: this connector takes only its own models, and
// src/kit/byModel.ts sends every other model to the talking one. The key (an AI Services key) goes as a bearer in each socket's
// opening request and nowhere else.
//
// One socket per stretch (wss://api.zoom.us/v2/aiservices/scribe/live): session.update sets 16 kHz PCM, the locale, the model
// and Scribe's own turn detection off, so the worker says when a stretch ends. Audio waits for session.updated, then goes as
// binary frames; input_audio_buffer.commit ends it, and Scribe answers with transcription.completed. Scribe sends no words
// before that. Its speaker tags, when it adds them, are taken out.
import type { RecognitionConnector, RecognitionSettings } from './connectors.ts';
import { pcmBytes } from './kit/pcm.ts';
import { baseLanguage } from './kit/signIn.ts';
import { socketHearing, type HearingMessage } from './kit/socketHearing.ts';
import type { Recognizer, RecognizerEvents } from './recognizer.ts';

export const ZOOM_SCRIBE_ADAPTER = 'zoom';
export const ZOOM_SCRIBE_ENDPOINT = 'wss://api.zoom.us';
const DEFAULT_MODEL = 'zoom-scribe-multilingual';
export const ZOOM_SCRIBE_MODELS: ReadonlySet<string> = new Set([DEFAULT_MODEL, 'whisper']);

/** Scribe's locale for each language (Pipecat's list); a language it doesn't list is heard as US English. */
const LOCALES: Record<string, string> = {
    ar: 'ar-SA',
    bn: 'bn-IN',
    ca: 'ca-ES',
    cs: 'cs-CZ',
    da: 'da-DK',
    de: 'de-DE',
    el: 'el-GR',
    en: 'en-US',
    es: 'es-ES',
    et: 'et-EE',
    fa: 'fa-IR',
    fi: 'fi-FI',
    fil: 'tl-PH',
    fr: 'fr-FR',
    he: 'he-IL',
    hi: 'hi-IN',
    hu: 'hu-HU',
    id: 'id-ID',
    it: 'it-IT',
    ja: 'ja-JP',
    ko: 'ko-KR',
    ms: 'ms-MY',
    nl: 'nl-NL',
    pl: 'pl-PL',
    pt: 'pt-BR',
    ro: 'ro-RO',
    ru: 'ru-RU',
    sv: 'sv-SE',
    ta: 'ta-IN',
    te: 'te-IN',
    th: 'th-TH',
    tl: 'tl-PH',
    tr: 'tr-TR',
    uk: 'uk-UA',
    vi: 'vi-VN',
    yue: 'zh-HK',
    zh: 'zh-CN',
};
/** The regional locales Scribe lists besides each language's own. */
const REGIONAL = new Set(['ar-AE', 'pt-PT', 'zh-HK']);

/** The locale Scribe is told to hear. */
export function zoomLocale(language: string | undefined): string {
    if (!language) return 'en-US';
    const [base, region = ''] = language.split(/[-_]/);
    const locale = `${base.toLowerCase()}-${region.toUpperCase()}`;
    if (REGIONAL.has(locale)) return locale;
    return LOCALES[baseLanguage(language)] ?? 'en-US';
}

/** Scribe's speaker or channel tags, added when it tells speakers apart. */
const SPEAKER_TAG = /\[(?:speaker[ _]?\d+|spk_\d+|channel\d+)\]\s*/gi;

interface ScribeAnswer {
    type?: unknown;
    transcript?: unknown;
    error?: { code?: unknown; message?: unknown } | unknown;
}

/** The status a Scribe error reads as, from its code or words. */
function scribeStatus(answer: ScribeAnswer): number | undefined {
    const error = typeof answer.error === 'object' && answer.error !== null ? (answer.error as Record<string, unknown>) : {};
    const code = Number(error.code);
    if (Number.isInteger(code) && code >= 400 && code < 600) return code;
    const text = `${String(error.code ?? '')} ${String(error.message ?? '')}`;
    if (/token|unauthori[sz]ed|authenticat|api.?key/i.test(text)) return 401;
    if (/quota|billing|balance|credit/i.test(text)) return 402;
    if (/permission|forbidden|not enabled/i.test(text)) return 403;
    if (/rate.?limit|too many/i.test(text)) return 429;
    return undefined;
}

export class ZoomScribeRecognition implements RecognitionConnector {
    constructor(private readonly options: { finalTimeoutMs?: number } = {}) {}

    listen(settings: RecognitionSettings, events: RecognizerEvents): Recognizer {
        // Only the transcript that answers the commit ends the stretch
        let finishing = false;
        return socketHearing({
            adapter: ZOOM_SCRIBE_ADAPTER,
            endpoint: ZOOM_SCRIBE_ENDPOINT,
            finalTimeoutMs: this.options.finalTimeoutMs,
            connect: (settings: RecognitionSettings, base) => ({
                url: `${base.replace(/^http/, 'ws')}/v2/aiservices/scribe/live`,
                headers: { authorization: `Bearer ${settings.key.reveal()}` },
            }),
            start: (settings: RecognitionSettings) => [
                JSON.stringify({
                    type: 'session.update',
                    language: zoomLocale(settings.language),
                    audio: { format: 'pcm16' },
                    config: { model: settings.model || DEFAULT_MODEL },
                    turn_detection: { type: 'none' },
                }),
            ],
            readyFirst: true,
            frame: (pcm16k: Int16Array) => pcmBytes(pcm16k),
            finish: () => {
                finishing = true;
                return [JSON.stringify({ type: 'input_audio_buffer.commit' })];
            },
            read: (data, isBinary): HearingMessage | HearingMessage[] | undefined => {
                if (isBinary) return undefined;
                const answer = JSON.parse(data.toString()) as unknown;
                if (typeof answer !== 'object' || answer === null) return undefined;
                const event = answer as ScribeAnswer;
                switch (event.type) {
                    case 'session.updated':
                        return { ready: true };
                    case 'transcription.completed': {
                        const text = typeof event.transcript === 'string' ? event.transcript.replace(SPEAKER_TAG, '').trim() : '';
                        const words: HearingMessage = text ? { committed: text } : { interim: '' };
                        return finishing ? [words, { finished: true }] : words;
                    }
                    case 'error':
                        return { error: { status: scribeStatus(event) } };
                    default:
                        return undefined;
                }
            },
        }).listen(settings, events);
    }
}
