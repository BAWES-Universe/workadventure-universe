// Hearing and speaking with Azure AI Speech (#1875), on the shared kit (#1883), as Pipecat's AzureSTTService and
// AzureHttpTTSService do, with a Speech resource's key in the region picked on Add a key (Orbit). The key goes in the
// Ocp-Apim-Subscription-Key header of each socket's opening request or each spoken reply, and nowhere else.
//
// Hearing: one socket per stretch, in the Speech service's own protocol, the one its SDK speaks
// (wss://<region>.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1). Every message carries
// headers (Path, X-RequestId, X-Timestamp) before its body: text messages separate them with a blank line, audio messages
// put their length in the first two bytes. speech.config opens; then audio, the first piece a WAV header that says 16 kHz
// mono s16; an empty audio message ends it. Azure answers speech.hypothesis (words that may change), speech.phrase (a phrase
// that won't) and turn.end once the last words are in.
// https://learn.microsoft.com/azure/ai-services/speech-service/speech-to-text
//
// Speaking: one request per reply, SSML to https://<region>.tts.speech.microsoft.com/cognitiveservices/v1, answered with raw
// 24 kHz s16 PCM. https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech
import { randomUUID } from 'node:crypto';
import type { RecognitionConnector, RecognitionSettings, SpeechConnector, SpeechRequest } from './connectors.ts';
import { failure } from './kit/errors.ts';
import { httpSpeech, SPEECH_RATE } from './kit/httpSpeech.ts';
import { pcmBytes } from './kit/pcm.ts';
import { baseLanguage } from './kit/signIn.ts';
import { socketHearing, type HearingMessage } from './kit/socketHearing.ts';
import type { Recognizer, RecognizerEvents } from './recognizer.ts';

export const AZURE_SPEECH_ADAPTER = 'azure-speech';

/** Pipecat's default voice, used when a bot names none. */
const DEFAULT_VOICE = 'en-US-SaraNeural';

/** Azure takes long replies; past this a reply is cut, as every other company's is. */
const MAX_TEXT = 5000;

/** An Azure region name, as Orbit keeps it (eastus, uaenorth): never a host or a path. */
const AZURE_REGION = /^[a-z][a-z0-9]{1,30}$/;

/** The locale Azure hears and speaks for a language with no region of its own, its most spoken one. */
const LOCALES: Record<string, string> = {
    af: 'af-ZA',
    am: 'am-ET',
    ar: 'ar-SA',
    az: 'az-AZ',
    bg: 'bg-BG',
    bn: 'bn-IN',
    bs: 'bs-BA',
    ca: 'ca-ES',
    cs: 'cs-CZ',
    cy: 'cy-GB',
    da: 'da-DK',
    de: 'de-DE',
    el: 'el-GR',
    en: 'en-US',
    es: 'es-ES',
    et: 'et-EE',
    eu: 'eu-ES',
    fa: 'fa-IR',
    fi: 'fi-FI',
    fil: 'fil-PH',
    fr: 'fr-FR',
    ga: 'ga-IE',
    gl: 'gl-ES',
    gu: 'gu-IN',
    he: 'he-IL',
    hi: 'hi-IN',
    hr: 'hr-HR',
    hu: 'hu-HU',
    hy: 'hy-AM',
    id: 'id-ID',
    is: 'is-IS',
    it: 'it-IT',
    ja: 'ja-JP',
    jv: 'jv-ID',
    ka: 'ka-GE',
    kk: 'kk-KZ',
    km: 'km-KH',
    kn: 'kn-IN',
    ko: 'ko-KR',
    lo: 'lo-LA',
    lt: 'lt-LT',
    lv: 'lv-LV',
    mk: 'mk-MK',
    ml: 'ml-IN',
    mn: 'mn-MN',
    mr: 'mr-IN',
    ms: 'ms-MY',
    mt: 'mt-MT',
    my: 'my-MM',
    nb: 'nb-NO',
    ne: 'ne-NP',
    nl: 'nl-NL',
    no: 'nb-NO',
    pa: 'pa-IN',
    pl: 'pl-PL',
    ps: 'ps-AF',
    pt: 'pt-BR',
    ro: 'ro-RO',
    ru: 'ru-RU',
    si: 'si-LK',
    sk: 'sk-SK',
    sl: 'sl-SI',
    so: 'so-SO',
    sq: 'sq-AL',
    sr: 'sr-RS',
    sv: 'sv-SE',
    sw: 'sw-KE',
    ta: 'ta-IN',
    te: 'te-IN',
    th: 'th-TH',
    tl: 'fil-PH',
    tr: 'tr-TR',
    uk: 'uk-UA',
    ur: 'ur-PK',
    uz: 'uz-UZ',
    vi: 'vi-VN',
    yue: 'zh-HK',
    zh: 'zh-CN',
    zu: 'zu-ZA',
};

/**
 * The locale Azure is told to hear, as Azure writes it (ar-KW). A language with its own region keeps it: Azure hears 18 Arabic
 * locales, Kuwait's among them. One without is its most spoken locale, and with none known, US English.
 */
export function azureLocale(language: string | undefined): string {
    if (!language) return 'en-US';
    const [base = '', region = ''] = language.split(/[-_]/);
    if (/^[a-z]{2,3}$/i.test(base) && /^[a-z]{2}$/i.test(region)) return `${base.toLowerCase()}-${region.toUpperCase()}`;
    // Traditional Chinese (zh-Hant) is Taiwan's; any other script tag (zh-Hans, sr-Latn) reads as its language
    if (base.toLowerCase() === 'zh' && /^hant$/i.test(region)) return 'zh-TW';
    return LOCALES[baseLanguage(language)] ?? 'en-US';
}

/** The region a call goes to, or a failure that says it is missing. */
function regionOf(settings: { region?: string }): string {
    const region = settings.region ?? '';
    if (!AZURE_REGION.test(region)) throw failure(AZURE_SPEECH_ADAPTER, 'has no region', 400);
    return region;
}

/** One message of the Speech protocol's headers, each line ending in CRLF. */
function headers(path: string, requestId: string, contentType?: string): string {
    return [`Path: ${path}`, `X-RequestId: ${requestId}`, `X-Timestamp: ${new Date().toISOString()}`, ...(contentType ? [`Content-Type: ${contentType}`] : [])]
        .map((line) => `${line}\r\n`)
        .join('');
}

/** A text message: headers, a blank line, then the body. */
export function textMessage(path: string, requestId: string, body: unknown): string {
    return `${headers(path, requestId, 'application/json')}\r\n${JSON.stringify(body)}`;
}

/** An audio message: the headers' length in two bytes (big-endian), the headers, then the audio. An empty one ends the audio. */
export function audioMessage(requestId: string, audio: Uint8Array): Uint8Array {
    const head = Buffer.from(headers('audio', requestId, 'audio/x-wav'), 'ascii');
    const out = new Uint8Array(2 + head.length + audio.length);
    new DataView(out.buffer).setUint16(0, head.length);
    out.set(head, 2);
    out.set(audio, 2 + head.length);
    return out;
}

/** A WAV header for 16 kHz mono s16 of unknown length: the first audio Azure reads says what follows. */
export function wavHeader(sampleRate = 16000): Uint8Array {
    const header = new DataView(new ArrayBuffer(44));
    const text = (at: number, value: string) => [...value].forEach((char, i) => header.setUint8(at + i, char.charCodeAt(0)));
    text(0, 'RIFF');
    header.setUint32(4, 0, true);
    text(8, 'WAVE');
    text(12, 'fmt ');
    header.setUint32(16, 16, true);
    header.setUint16(20, 1, true); // PCM
    header.setUint16(22, 1, true); // mono
    header.setUint32(24, sampleRate, true);
    header.setUint32(28, sampleRate * 2, true);
    header.setUint16(32, 2, true);
    header.setUint16(34, 16, true);
    text(36, 'data');
    header.setUint32(40, 0, true);
    return new Uint8Array(header.buffer);
}

/** A text message from Azure: its Path header and its JSON body. */
export function readMessage(data: string): { path: string; body: Record<string, unknown> } | undefined {
    const split = data.indexOf('\r\n\r\n');
    if (split < 0) return undefined;
    const path = /^path:\s*(.+)$/im.exec(data.slice(0, split))?.[1]?.trim().toLowerCase();
    if (!path) return undefined;
    const text = data.slice(split + 4);
    let body: unknown = {};
    if (text.trim()) {
        try {
            body = JSON.parse(text);
        } catch {
            return undefined;
        }
    }
    return { path, body: typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {} };
}

/** What a close from Azure means: it closes with 1007 or 1008 and a reason when it turns a call away; 1000 is a clean end. */
function closedStatus(code: number, reason: string): HearingMessage | undefined {
    if (code === 1000 || code === 1005) return undefined;
    if (/quota|limit|throttl|too many/i.test(reason)) return { error: { status: 429 } };
    if (/auth|subscription|key|token/i.test(reason)) return { error: { status: 401 } };
    if (code === 1007 || code === 1008) return { error: { status: 400 } };
    // Any other close (1006 a dropped connection, 1011 a server error, 1012/1013 a restart) is a failure, even while the last
    // words are awaited: never the end of what was heard
    const status = code === 1011 ? 500 : code === 1012 || code === 1013 ? 503 : undefined;
    return { error: status === undefined ? {} : { status } };
}

export class AzureSpeechRecognition implements RecognitionConnector {
    constructor(private readonly options: { finalTimeoutMs?: number } = {}) {}

    listen(settings: RecognitionSettings, events: RecognizerEvents): Recognizer {
        // One request per stretch: every message of this socket carries its id
        const requestId = randomUUID().replace(/-/g, '');
        return socketHearing({
            adapter: AZURE_SPEECH_ADAPTER,
            endpoint: 'wss://eastus.stt.speech.microsoft.com',
            finalTimeoutMs: this.options.finalTimeoutMs,
            connect: (settings: RecognitionSettings, base) => {
                const region = regionOf(settings);
                // The region names the host; an address typed on the server's own provider (a stand-in in tests) is used as it is
                const origin = settings.endpoint ? base.replace(/^http/, 'ws') : `wss://${region}.stt.speech.microsoft.com`;
                const query = new URLSearchParams({ language: azureLocale(settings.language), format: 'simple' });
                return {
                    url: `${origin}/speech/recognition/conversation/cognitiveservices/v1?${query}`,
                    headers: { 'Ocp-Apim-Subscription-Key': settings.key.reveal(), 'X-ConnectionId': randomUUID().replace(/-/g, '') },
                };
            },
            start: () => [
                textMessage('speech.config', requestId, {
                    context: { system: { name: 'SpeechSDK', version: '1.40.0', build: 'JavaScript', lang: 'JavaScript' }, os: { platform: 'Node' } },
                }),
                audioMessage(requestId, wavHeader()),
            ],
            frame: (pcm16k: Int16Array) => audioMessage(requestId, pcmBytes(pcm16k)),
            finish: () => [audioMessage(requestId, new Uint8Array(0))],
            read: (data, isBinary): HearingMessage | undefined => {
                if (isBinary) return undefined;
                const message = readMessage(data.toString());
                if (!message) return undefined;
                const { path, body } = message;
                if (path === 'speech.hypothesis' || path === 'speech.fragment') {
                    return typeof body.Text === 'string' ? { interim: body.Text } : undefined;
                }
                if (path === 'speech.phrase') {
                    const status = String(body.RecognitionStatus ?? '');
                    if (status === 'Success') {
                        const text = typeof body.DisplayText === 'string' ? body.DisplayText.trim() : '';
                        return text ? { committed: text } : { interim: '' };
                    }
                    // Silence, nothing recognised, or the end of the audio: no words, and nothing failed
                    if (['InitialSilenceTimeout', 'BabbleTimeout', 'NoMatch', 'EndOfDictation'].includes(status)) return { interim: '' };
                    if (status === 'BadRequest') return { error: { status: 400 } };
                    if (status === 'TooManyRequests') return { error: { status: 429 } };
                    if (status === 'Error') return { error: {} };
                    return undefined;
                }
                if (path === 'turn.end') return { finished: true };
                return undefined;
            },
            closed: closedStatus,
            closeIsFinished: true,
        }).listen(settings, events);
    }
}

const xml = (text: string) => text.replace(/[<>&'"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[char] as string);

/**
 * The SSML for one reply. The voice's own locale is the reply's (ar-KW-FahedNeural speaks ar-KW); a multilingual voice is also
 * told which language to speak, since it can speak many.
 */
export function azureSsml(text: string, voice: string, language: string | undefined): string {
    const voiceLocale = /^([a-z]{2,3}-[A-Z]{2,4}(?:-[A-Za-z]+)?)-/.exec(voice)?.[1] ?? 'en-US';
    const inner = /multilingual/i.test(voice) && language ? `<lang xml:lang='${azureLocale(language)}'>${xml(text)}</lang>` : xml(text);
    return `<speak version='1.0' xml:lang='${voiceLocale}' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='https://www.w3.org/2001/mstts'><voice name='${xml(voice)}'>${inner}</voice></speak>`;
}

export class AzureTts implements SpeechConnector {
    private readonly connector = httpSpeech({
        adapter: AZURE_SPEECH_ADAPTER,
        endpoint: 'https://eastus.tts.speech.microsoft.com',
        audio: { kind: 'raw', sampleRate: SPEECH_RATE },
        call: (request: SpeechRequest, base) => {
            const region = regionOf(request.settings);
            // The region names the host; an address typed on the server's own provider (a stand-in in tests) is used as it is
            const origin = request.settings.endpoint ? base : `https://${region}.tts.speech.microsoft.com`;
            return {
                url: `${origin}/cognitiveservices/v1`,
                headers: {
                    'Ocp-Apim-Subscription-Key': request.settings.key.reveal(),
                    'content-type': 'application/ssml+xml',
                    'X-Microsoft-OutputFormat': 'raw-24khz-16bit-mono-pcm',
                    'user-agent': 'universe-voice-worker',
                },
                body: azureSsml(request.text.slice(0, MAX_TEXT), request.settings.voiceId || DEFAULT_VOICE, request.lang || request.settings.language),
            };
        },
    });

    speak(request: SpeechRequest): AsyncIterable<Int16Array> {
        return this.connector.speak(request);
    }
}
