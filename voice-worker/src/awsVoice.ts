// Hearing with Amazon Transcribe and speaking with Amazon Polly (#1886), as Pipecat's AWSTranscribeSTTService and
// AWSPollyTTSService do, with the AWS key kept as one, "ID:secret" (Orbit), in the region picked. Neither part of the key is
// sent: each call is signed with it (src/kit/awsSign.ts).
//
// AWS also talks live (src/aws.ts, Nova Sonic, #1910) under the same adapter: these connectors take only their own models, and
// src/kit/byModel.ts sends every other model to the talking one.
//
// Hearing: one Transcribe socket per stretch, at a presigned address (wss://transcribestreaming.<region>.amazonaws.com:8443)
// naming 16 kHz PCM, the locale and stable partial results. Audio goes as AudioEvent messages in AWS's event stream framing
// (src/kit/eventStream.ts); an empty AudioEvent ends it, and Transcribe sends the last results, then closes. Each result is the
// words so far until IsPartial is false.
//
// Speaking: one signed POST to Polly's /v1/speech per reply, the model being Polly's engine; the answer is raw 16 kHz s16 audio.
import type { RecognitionConnector, RecognitionSettings, SpeechConnector, SpeechRequest } from './connectors.ts';
import { AWS_REGION, awsKey, presignUrl, signRequest } from './kit/awsSign.ts';
import { failure } from './kit/errors.ts';
import { decodeEventMessage, encodeEventMessage } from './kit/eventStream.ts';
import { httpSpeech } from './kit/httpSpeech.ts';
import { pcmBytes } from './kit/pcm.ts';
import { baseLanguage } from './kit/signIn.ts';
import { socketHearing, type HearingMessage } from './kit/socketHearing.ts';
import type { Recognizer, RecognizerEvents } from './recognizer.ts';

export const AWS_VOICE_ADAPTER = 'aws';
const HEARING_MODEL = 'amazon-transcribe';
export const AWS_HEARING_MODELS: ReadonlySet<string> = new Set([HEARING_MODEL]);
/** Polly's engines, each one of Orbit's models; generative is Orbit's first. */
export const AWS_SPEECH_MODELS: ReadonlySet<string> = new Set(['generative', 'neural', 'long-form', 'standard']);
const DEFAULT_ENGINE = 'generative';
/** Pipecat's default voice. */
const DEFAULT_VOICE = 'Joanna';
/** Polly gives PCM at 8 or 16 kHz: 16 kHz, resampled to the worker's 24. */
const POLLY_RATE = 16000;
/** Polly takes at most 3,000 billed characters a request. */
const MAX_TEXT = 3000;

/** Transcribe's locale for each language (Pipecat's list); a language it doesn't list is heard as US English. */
const LOCALES: Record<string, string> = {
    af: 'af-ZA',
    am: 'am-ET',
    ar: 'ar-SA',
    be: 'be-BY',
    bg: 'bg-BG',
    bn: 'bn-IN',
    bs: 'bs-BA',
    ca: 'ca-ES',
    cs: 'cs-CZ',
    cy: 'cy-WL',
    da: 'da-DK',
    de: 'de-DE',
    el: 'el-GR',
    en: 'en-US',
    es: 'es-ES',
    et: 'et-ET',
    eu: 'eu-ES',
    fa: 'fa-IR',
    fi: 'fi-FI',
    fil: 'tl-PH',
    fr: 'fr-FR',
    gl: 'gl-ES',
    gu: 'gu-IN',
    he: 'he-IL',
    hi: 'hi-IN',
    hr: 'hr-HR',
    ht: 'ht-HT',
    hu: 'hu-HU',
    hy: 'hy-AM',
    id: 'id-ID',
    is: 'is-IS',
    it: 'it-IT',
    ja: 'ja-JP',
    jv: 'jv-ID',
    ka: 'ka-GE',
    kab: 'kab-DZ',
    kk: 'kk-KZ',
    km: 'km-KH',
    kn: 'kn-IN',
    ko: 'ko-KR',
    lg: 'lg-IN',
    lt: 'lt-LT',
    lv: 'lv-LV',
    mk: 'mk-MK',
    ml: 'ml-IN',
    mr: 'mr-IN',
    ms: 'ms-MY',
    my: 'my-MM',
    nb: 'no-NO',
    ne: 'ne-NP',
    nl: 'nl-NL',
    no: 'no-NO',
    or: 'or-IN',
    pa: 'pa-IN',
    pl: 'pl-PL',
    ps: 'ps-AF',
    pt: 'pt-PT',
    ro: 'ro-RO',
    ru: 'ru-RU',
    si: 'si-LK',
    sk: 'sk-SK',
    sl: 'sl-SI',
    so: 'so-SO',
    sq: 'sq-AL',
    sr: 'sr-RS',
    su: 'su-ID',
    sv: 'sv-SE',
    sw: 'sw-KE',
    ta: 'ta-IN',
    te: 'te-IN',
    th: 'th-TH',
    tl: 'tl-PH',
    tr: 'tr-TR',
    uk: 'uk-UA',
    uz: 'uz-UZ',
    vi: 'vi-VN',
    yue: 'zh-HK',
    zh: 'zh-CN',
    zu: 'zu-ZA',
};
/** The regional locales Transcribe lists besides each language's own (Pipecat's list). */
const REGIONAL = new Set([
    'ar-AE',
    'ckb-IQ',
    'ckb-IR',
    'de-CH',
    'en-AB',
    'en-AU',
    'en-GB',
    'en-IE',
    'en-IN',
    'en-NZ',
    'en-WL',
    'en-ZA',
    'es-MX',
    'es-US',
    'fa-AF',
    'fr-CA',
    'pt-BR',
    'sw-BI',
    'sw-RW',
    'sw-TZ',
    'sw-UG',
    'zh-HK',
    'zh-TW',
]);

/** The locale Transcribe is told to hear. Gulf Arabic is its own; other Arabic is Modern Standard. */
export function transcribeLocale(language: string | undefined): string {
    if (!language) return 'en-US';
    const [base, region = ''] = language.split(/[-_]/);
    const locale = `${base.toLowerCase()}-${region.toUpperCase()}`;
    if (REGIONAL.has(locale)) return locale;
    if (base.toLowerCase() === 'ar' && ['BH', 'KW', 'OM', 'QA'].includes(region.toUpperCase())) return 'ar-AE';
    return LOCALES[baseLanguage(language)] ?? 'en-US';
}

/** The region and key a call is signed with, or a failure that says which is missing. */
function signing(settings: { key: { reveal(): string }; region?: string }) {
    const key = awsKey(settings.key.reveal());
    if (!key) throw failure(AWS_VOICE_ADAPTER, 'has a key that is not "ID:secret"', 401);
    const region = settings.region ?? '';
    if (!AWS_REGION.test(region)) throw failure(AWS_VOICE_ADAPTER, 'has no region', 400);
    return { key, region };
}

/** The status an AWS exception's type reads as. */
function exceptionStatus(type: string): number | undefined {
    if (/BadRequest|Validation/.test(type)) return 400;
    if (/UnrecognizedClient|InvalidSignature|AccessDenied|Forbidden/.test(type)) return 403;
    if (/LimitExceeded|Throttling|Quota/.test(type)) return 429;
    if (/ServiceUnavailable/.test(type)) return 503;
    if (/InternalFailure|InternalServer/.test(type)) return 500;
    return undefined;
}

interface TranscriptEvent {
    Transcript?: { Results?: { Alternatives?: { Transcript?: unknown }[]; IsPartial?: unknown; ChannelId?: unknown }[] };
}

const audioEvent = (bytes: Uint8Array) =>
    encodeEventMessage({ ':content-type': 'application/octet-stream', ':event-type': 'AudioEvent', ':message-type': 'event' }, bytes);

export class AwsTranscribe implements RecognitionConnector {
    constructor(private readonly options: { finalTimeoutMs?: number } = {}) {}

    listen(settings: RecognitionSettings, events: RecognizerEvents): Recognizer {
        return socketHearing({
            adapter: AWS_VOICE_ADAPTER,
            endpoint: 'wss://transcribestreaming.us-east-1.amazonaws.com:8443',
            finalTimeoutMs: this.options.finalTimeoutMs,
            connect: (settings: RecognitionSettings, base) => {
                const { key, region } = signing(settings);
                // The region names the host; an address typed on the server's own provider (a stand-in in tests) is used as it is
                const origin = settings.endpoint ? base.replace(/^http/, 'ws') : `wss://transcribestreaming.${region}.amazonaws.com:8443`;
                const url = new URL(`${origin}/stream-transcription-websocket`);
                url.searchParams.set('language-code', transcribeLocale(settings.language));
                url.searchParams.set('media-encoding', 'pcm');
                url.searchParams.set('sample-rate', '16000');
                url.searchParams.set('enable-partial-results-stabilization', 'true');
                url.searchParams.set('partial-results-stability', 'high');
                return { url: presignUrl(url, key, { region, service: 'transcribe' }), headers: {} };
            },
            frame: (pcm16k: Int16Array) => audioEvent(pcmBytes(pcm16k)),
            // An empty AudioEvent ends the audio; Transcribe sends the last results, then closes
            finish: () => [audioEvent(new Uint8Array(0))],
            closeIsFinished: true,
            read: (data, isBinary): HearingMessage | HearingMessage[] | undefined => {
                if (!isBinary) return undefined;
                const { headers, payload } = decodeEventMessage(data);
                if (headers[':message-type'] === 'exception') return { error: { status: exceptionStatus(headers[':exception-type'] ?? '') } };
                if (headers[':event-type'] !== 'TranscriptEvent') return undefined;
                const event = JSON.parse(payload.toString('utf8')) as TranscriptEvent;
                const out: HearingMessage[] = [];
                const interim: string[] = [];
                for (const result of event.Transcript?.Results ?? []) {
                    const text = String(result.Alternatives?.[0]?.Transcript ?? '').trim();
                    if (!text) continue;
                    if (result.IsPartial === false) out.push({ committed: text });
                    else interim.push(text);
                }
                out.push({ interim: interim.join(' ') });
                return out;
            },
        }).listen(settings, events);
    }
}

export class AwsPolly implements SpeechConnector {
    private readonly connector = httpSpeech({
        adapter: AWS_VOICE_ADAPTER,
        endpoint: 'https://polly.us-east-1.amazonaws.com',
        audio: { kind: 'raw', sampleRate: POLLY_RATE },
        call: (request: SpeechRequest, base) => {
            const { key, region } = signing(request.settings);
            const model = request.settings.model;
            const body = JSON.stringify({
                Engine: AWS_SPEECH_MODELS.has(model) ? model : DEFAULT_ENGINE,
                OutputFormat: 'pcm',
                SampleRate: String(POLLY_RATE),
                Text: request.text.slice(0, MAX_TEXT),
                TextType: 'text',
                VoiceId: request.settings.voiceId || DEFAULT_VOICE,
            });
            // The region names the host; an address typed on the server's own provider (a stand-in in tests) is used as it is
            const url = new URL(`${request.settings.endpoint ? base : `https://polly.${region}.amazonaws.com`}/v1/speech`);
            return { url: url.toString(), headers: signRequest('POST', url, body, 'application/json', key, { region, service: 'polly' }), body };
        },
    });

    speak(request: SpeechRequest): AsyncIterable<Int16Array> {
        return this.connector.speak(request);
    }
}
