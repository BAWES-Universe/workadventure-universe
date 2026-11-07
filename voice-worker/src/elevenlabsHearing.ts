// Listening with ElevenLabs (#1873), on the shared kit (#1883): ElevenLabs' real-time Scribe socket
// (/v1/speech-to-text/realtime), one per stretch of speech. The key goes in the xi-api-key header of that one connection and
// nowhere else. Audio is sent as base64 16 kHz s16 pieces; with the manual commit strategy nothing is final until the worker
// commits, so the words show as partial transcripts while the person speaks, and the commit sent at the pause brings the
// committed transcript that ends the stretch. ElevenLabs is told no end of speech of its own: the worker's pause ends a stretch.
import type { RecognitionConnector, RecognitionSettings } from './connectors.ts';
import { ELEVENLABS_ADAPTER } from './elevenlabs.ts';
import { pcmBytes } from './kit/pcm.ts';
import { baseLanguage } from './kit/signIn.ts';
import { socketHearing, type HearingMessage } from './kit/socketHearing.ts';
import type { Recognizer, RecognizerEvents } from './recognizer.ts';

export const ELEVENLABS_HEARING_ENDPOINT = 'wss://api.elevenlabs.io';

/** What each of ElevenLabs' error messages means as a status: a refused key, no credit, too busy, a bad request. */
const ERROR_STATUS: Record<string, number> = {
    auth_error: 401,
    unaccepted_terms: 403,
    quota_exceeded: 402,
    rate_limited: 429,
    resource_exhausted: 429,
    queue_overflow: 429,
    commit_throttled: 429,
    invalid_request: 400,
    input_error: 400,
    chunk_size_exceeded: 400,
};
const OTHER_ERRORS = new Set(['error', 'transcriber_error', 'session_time_limit_exceeded', 'insufficient_audio_activity']);

interface ElevenLabsAnswer {
    message_type?: unknown;
    text?: unknown;
}

export class ElevenLabsRecognition implements RecognitionConnector {
    private readonly connector: RecognitionConnector;

    constructor(options: { finalTimeoutMs?: number } = {}) {
        this.connector = socketHearing({
            adapter: ELEVENLABS_ADAPTER,
            endpoint: ELEVENLABS_HEARING_ENDPOINT,
            finalTimeoutMs: options.finalTimeoutMs,
            connect: (settings: RecognitionSettings, base) => {
                const query = new URLSearchParams({ model_id: settings.model, audio_format: 'pcm_16000', commit_strategy: 'manual' });
                if (settings.language) query.set('language_code', baseLanguage(settings.language));
                return { url: `${base}/v1/speech-to-text/realtime?${query}`, headers: { 'xi-api-key': settings.key.reveal() } };
            },
            frame: (pcm16k) => JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: pcmBytes(pcm16k).toString('base64'), commit: false, sample_rate: 16000 }),
            finish: () => [JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: '', commit: true, sample_rate: 16000 })],
            read: (data, isBinary): HearingMessage | undefined => {
                if (isBinary) return undefined;
                const answer = JSON.parse(data.toString()) as ElevenLabsAnswer;
                if (typeof answer !== 'object' || answer === null || typeof answer.message_type !== 'string') return undefined;
                const type = answer.message_type;
                const text = typeof answer.text === 'string' ? answer.text : '';
                if (type === 'partial_transcript') return { interim: text };
                // Only the worker commits, at the pause: the committed words are the stretch's last
                if (type === 'committed_transcript') return { committed: text, finished: true };
                if (type in ERROR_STATUS) return { error: { status: ERROR_STATUS[type] } };
                if (OTHER_ERRORS.has(type)) return { error: {} };
                return undefined;
            },
        });
    }

    listen(settings: RecognitionSettings, events: RecognizerEvents): Recognizer {
        return this.connector.listen(settings, events);
    }
}
