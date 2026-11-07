// Hearing with Gladia (#1885), on the shared kit (#1883): Gladia's live API, one session per stretch of speech, as Pipecat's
// GladiaSTTService does. https://docs.gladia.io/api-reference/v2/live/init
//
// A session is asked for first (POST /v2/live, the key in the x-gladia-key header of that one request and nowhere else), and
// Gladia answers with the socket address for it, which carries its own one-session token rather than the key. Audio goes as
// binary 16 kHz s16. Each utterance shows as it grows and is kept once Gladia calls it final. "stop_recording" ends the audio:
// Gladia sends the last words, then closes the socket with 1000.
import type { RecognitionConnector, RecognitionSettings } from './connectors.ts';
import { answerStatus, failure, readSome } from './kit/errors.ts';
import { baseLanguage } from './kit/signIn.ts';
import { socketHearing, type HearingMessage, type SocketAddress } from './kit/socketHearing.ts';
import type { Recognizer, RecognizerEvents } from './recognizer.ts';

export const GLADIA_ADAPTER = 'gladia';
export const GLADIA_ENDPOINT = 'https://api.gladia.io';
/** How long asking for a session may take. */
const SESSION_TIMEOUT_MS = 10_000;

interface GladiaAnswer {
    type?: unknown;
    data?: { is_final?: unknown; utterance?: { text?: unknown } };
}

/** Asks Gladia for a live session and gives back its socket address. */
async function openSession(settings: RecognitionSettings, base: string): Promise<SocketAddress> {
    const body = {
        encoding: 'wav/pcm',
        bit_depth: 16,
        sample_rate: 16_000,
        channels: 1,
        model: settings.model,
        // One language when the profile names one; else Gladia works it out
        ...(settings.language ? { language_config: { languages: [baseLanguage(settings.language)], code_switching: false } } : {}),
        messages_config: { receive_partial_transcripts: true, receive_final_transcripts: true },
    };
    let response: Response;
    try {
        response = await fetch(`${base}/v2/live`, {
            method: 'POST',
            headers: { 'x-gladia-key': settings.key.reveal(), 'content-type': 'application/json' },
            body: JSON.stringify(body),
            redirect: 'manual',
            signal: AbortSignal.timeout(SESSION_TIMEOUT_MS),
        });
    } catch {
        throw failure(GLADIA_ADAPTER, 'could not be reached');
    }
    if (!response.ok) throw failure(GLADIA_ADAPTER, 'refused the session', answerStatus(response.status, await readSome(response.body)));
    let url: unknown;
    try {
        url = ((await response.json()) as { url?: unknown }).url;
    } catch {
        url = undefined;
    }
    if (typeof url !== 'string' || !/^wss?:\/\//i.test(url)) throw failure(GLADIA_ADAPTER, 'sent a session without a socket address');
    return { url };
}

export class GladiaRecognition implements RecognitionConnector {
    private readonly connector: RecognitionConnector;

    constructor(options: { finalTimeoutMs?: number } = {}) {
        this.connector = socketHearing({
            adapter: GLADIA_ADAPTER,
            endpoint: GLADIA_ENDPOINT,
            finalTimeoutMs: options.finalTimeoutMs,
            connect: openSession,
            finish: () => [JSON.stringify({ type: 'stop_recording' })],
            closeIsFinished: true,
            read: (data, isBinary): HearingMessage | undefined => {
                if (isBinary) return undefined;
                const answer = JSON.parse(data.toString()) as GladiaAnswer;
                if (typeof answer !== 'object' || answer === null || answer.type !== 'transcript') return undefined;
                const text = answer.data?.utterance?.text;
                if (typeof text !== 'string') return undefined;
                return answer.data?.is_final === true ? { committed: text.trim() } : { interim: text.trim() };
            },
        });
    }

    listen(settings: RecognitionSettings, events: RecognizerEvents): Recognizer {
        return this.connector.listen(settings, events);
    }
}
