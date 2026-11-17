// Hearing and speaking with Mistral (#1897), on the shared kit (#1883), as Pipecat's MistralSTTService and MistralTTSService do.
//
// Hearing: Voxtral's live socket (wss://api.mistral.ai/v1/audio/transcriptions/realtime?model=…, the key as a bearer). Mistral
// opens the session first ("session.created"); the session's audio format and language are then set ("session.update") and audio
// goes as base64 16 kHz s16 in "input_audio.append". The words come as deltas; "input_audio.flush" and "input_audio.end" end the
// audio, and "transcription.done" says the last words came.
//
// Speaking: POST /v1/audio/speech with stream on and pcm out. The answer is server-sent events, each "speech.audio.delta" holding
// base64 24 kHz 32-bit float samples, until "speech.audio.done".
import type { RecognitionConnector, RecognitionSettings, SpeechConnector, SpeechRequest } from './connectors.ts';
import { httpSpeech } from './kit/httpSpeech.ts';
import { pcmBytes } from './kit/pcm.ts';
import { baseLanguage } from './kit/signIn.ts';
import { socketHearing, type HearingMessage } from './kit/socketHearing.ts';
import type { Recognizer, RecognizerEvents } from './recognizer.ts';

export const MISTRAL_ADAPTER = 'mistral';
export const MISTRAL_HEARING_ENDPOINT = 'wss://api.mistral.ai';
export const MISTRAL_SPEECH_ENDPOINT = 'https://api.mistral.ai';

interface MistralEvent {
    type?: unknown;
    text?: unknown;
    audio_data?: unknown;
    error?: { code?: unknown; message?: unknown };
}

/** The status Mistral's error carries, when it is an HTTP-like one (401 for a key it won't take). */
function mistralStatus(error: MistralEvent['error']): number | undefined {
    const code = error?.code;
    return typeof code === 'number' && code >= 400 && code < 600 ? code : undefined;
}

export class MistralRecognition implements RecognitionConnector {
    private readonly connector: RecognitionConnector;

    constructor(options: { finalTimeoutMs?: number } = {}) {
        this.connector = socketHearing({
            adapter: MISTRAL_ADAPTER,
            endpoint: MISTRAL_HEARING_ENDPOINT,
            finalTimeoutMs: options.finalTimeoutMs,
            connect: (settings: RecognitionSettings, base) => ({
                url: `${base}/v1/audio/transcriptions/realtime?model=${encodeURIComponent(settings.model)}`,
                headers: { authorization: `Bearer ${settings.key.reveal()}` },
            }),
            readyFirst: true,
            whenReady: (settings) => [
                JSON.stringify({
                    type: 'session.update',
                    session: {
                        audio_format: { encoding: 'pcm_s16le', sample_rate: 16_000 },
                        ...(settings.language ? { language: baseLanguage(settings.language) } : {}),
                    },
                }),
            ],
            frame: (pcm16k) => JSON.stringify({ type: 'input_audio.append', audio: pcmBytes(pcm16k).toString('base64') }),
            finish: () => [JSON.stringify({ type: 'input_audio.flush' }), JSON.stringify({ type: 'input_audio.end' })],
            // The words come as pieces of text with their own spaces
            join: 'tokens',
            read: (data, isBinary): HearingMessage | undefined => {
                if (isBinary) return undefined;
                const event = JSON.parse(data.toString()) as MistralEvent;
                if (typeof event !== 'object' || event === null) return undefined;
                if (event.type === 'session.created') return { ready: true };
                if (event.type === 'error') return { error: { status: mistralStatus(event.error) } };
                if (event.type === 'transcription.text.delta' && typeof event.text === 'string' && event.text) return { committed: event.text };
                if (event.type === 'transcription.done') return { finished: true };
                return undefined;
            },
        });
    }

    listen(settings: RecognitionSettings, events: RecognizerEvents): Recognizer {
        return this.connector.listen(settings, events);
    }
}

export class MistralSpeech implements SpeechConnector {
    private readonly connector = httpSpeech({
        adapter: MISTRAL_ADAPTER,
        endpoint: MISTRAL_SPEECH_ENDPOINT,
        call: (request: SpeechRequest) => ({
            url: '/v1/audio/speech',
            headers: { authorization: `Bearer ${request.settings.key.reveal()}`, 'content-type': 'application/json', accept: 'text/event-stream' },
            body: JSON.stringify({
                input: request.text,
                model: request.settings.model,
                // No voice picked: Mistral's own default
                ...(request.settings.voiceId ? { voice_id: request.settings.voiceId } : {}),
                response_format: 'pcm',
                stream: true,
            }),
        }),
        audio: {
            kind: 'lines',
            sampleRate: 24_000,
            encoding: 'base64',
            samples: 'f32',
            read: (message) => {
                const event = message as MistralEvent;
                if (event?.type === 'speech.audio.delta' && typeof event.audio_data === 'string') return { audio: event.audio_data };
                if (event?.type === 'speech.audio.done') return { done: true };
                if (event?.type === 'error' || event?.error) return { error: { status: mistralStatus(event.error) } };
                return undefined;
            },
        },
    });

    speak(request: SpeechRequest): AsyncIterable<Int16Array> {
        return this.connector.speak(request);
    }
}
