// Hearing with Meta (#1895), on the shared kit (#1883): Muse Voice's live socket, one socket per stretch of speech, as
// Pipecat's MetaSTTService does. https://dev.meta.ai/docs/api-reference/voice/realtime
//
// The key goes in the first message (the handshake), not in a header, and Meta answers it with a session id before it takes
// any audio, so audio is held until then. Audio goes as binary 16 kHz s16. In ENDPOINTING mode each partial carries the whole
// current guess for the turn, and "speechComplete" carries the turn's final, punctuated words. {"type":"endStream"} ends the
// audio: Meta sends what it still owes, then closes the socket.
import { randomUUID } from 'node:crypto';
import type { RecognitionConnector, RecognitionSettings } from './connectors.ts';
import { baseLanguage } from './kit/signIn.ts';
import { socketHearing, type HearingMessage } from './kit/socketHearing.ts';
import type { Recognizer, RecognizerEvents } from './recognizer.ts';

export const META_ADAPTER = 'meta';
export const META_ENDPOINT = 'wss://api.meta.ai/v1/asr/realtime';

/** Meta biases hearing toward a language by its English name (Pipecat's verified list); any other language is left to Meta. */
const LANGUAGE_NAMES: Record<string, string> = {
    ar: 'Arabic',
    bn: 'Bengali',
    de: 'German',
    en: 'English',
    es: 'Spanish',
    fr: 'French',
    he: 'Hebrew',
    hi: 'Hindi',
    id: 'Indonesian',
    it: 'Italian',
    ja: 'Japanese',
    kn: 'Kannada',
    ko: 'Korean',
    mr: 'Marathi',
    ms: 'Malay',
    nl: 'Dutch',
    pl: 'Polish',
    pt: 'Portuguese',
    ta: 'Tamil',
    te: 'Telugu',
    th: 'Thai',
    tl: 'Tagalog',
    tr: 'Turkish',
    vi: 'Vietnamese',
    zh: 'Mandarin Chinese',
};

/** The name Meta takes for a language, or undefined to let Meta work it out. */
export function metaLanguage(language: string | undefined): string | undefined {
    return language ? LANGUAGE_NAMES[baseLanguage(language)] : undefined;
}

interface MetaAnswer {
    type?: unknown;
    sessionId?: unknown;
    transcript?: unknown;
    message?: unknown;
}

/**
 * The status a refusal reads as: a key Meta won't take is 401, so the profile says so. Only words that say the key itself is refused
 * count: a message that merely mentions tokens or a key (a rate limit, a quota) is an ordinary failure and must not mark a good key as
 * rejected.
 */
const REFUSED_KEY = /unauthori[sz]ed|forbidden|authenticat\w*\W+(failed|failure|error|required)|not\W+authenticated|(invalid|expired|revoked|missing|bad)\W+(access\W+)?(token|api\W*key|credential)|(token|api\W*key|credential)s?\W+(is\W+|are\W+|was\W+)?(invalid|expired|revoked|missing|not valid)/i;

export function metaStatus(message: unknown): number | undefined {
    return typeof message === 'string' && REFUSED_KEY.test(message) ? 401 : undefined;
}

export class MetaRecognition implements RecognitionConnector {
    private readonly connector: RecognitionConnector;

    constructor(options: { finalTimeoutMs?: number } = {}) {
        this.connector = socketHearing({
            adapter: META_ADAPTER,
            endpoint: META_ENDPOINT,
            finalTimeoutMs: options.finalTimeoutMs,
            connect: (_settings, base) => ({ url: `${base}?sessionId=stream-${randomUUID()}` }),
            start: (settings: RecognitionSettings) => {
                const language = metaLanguage(settings.language);
                return [
                    JSON.stringify({
                        authorization: { accessToken: `Bearer ${settings.key.reveal()}` },
                        audioEncoding: 'PCM_16KHZ',
                        model: settings.model,
                        mode: 'ENDPOINTING',
                        partialMode: 'CUMULATIVE',
                        emitAudioProgress: false,
                        ...(language ? { languageBias: [language] } : {}),
                    }),
                ];
            },
            readyFirst: true,
            finish: () => [JSON.stringify({ type: 'endStream' })],
            closeIsFinished: true,
            // Only a normal close ends with the last words: any other close (a dropped line, an error code) is a failure
            closed: (code) => (code === 1000 ? undefined : { error: {} }),
            read: (data, isBinary): HearingMessage | undefined => {
                if (isBinary) return undefined;
                const answer = JSON.parse(data.toString()) as MetaAnswer;
                if (typeof answer !== 'object' || answer === null) return undefined;
                if (answer.type === 'error') return { error: { status: metaStatus(answer.message) } };
                if (typeof answer.sessionId === 'string' && answer.sessionId && answer.type === undefined) return { ready: true };
                const text = typeof answer.transcript === 'string' ? answer.transcript.trim() : '';
                if (answer.type === 'transcript') return { interim: text };
                // The turn's final words: kept, and the end of what the person said
                if (answer.type === 'speechComplete') return text ? { committed: text, endpoint: true } : { interim: '', endpoint: true };
                return undefined;
            },
        });
    }

    listen(settings: RecognitionSettings, events: RecognizerEvents): Recognizer {
        return this.connector.listen(settings, events);
    }
}
