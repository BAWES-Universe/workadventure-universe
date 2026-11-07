// Inworld's realtime session (game #1910), a talking model: it hears with Inworld STT and speaks with Inworld TTS, and the bot's
// own Mind writes every answer. Its socket speaks OpenAI's Realtime events (openai.ts), with these differences, from Inworld's
// realtime docs (Nov 2026):
//
// - The socket is wss://api.inworld.ai/api/v1/realtime/session?key=<a session id of our own>&protocol=realtime. The key goes in
//   the Authorization header as Basic, as it is: Inworld's key is already base64(ID:secret). Nowhere else.
// - Hearing: the same as OpenAI's, written down by Inworld STT; its turn detection never answers (create_response false), so
//   its LLM is never called.
// - Speaking: Inworld speaks given words as they are (`response.speak`), without its LLM: the Mind's words are read by its TTS
//   model, the key's talking model, in the picked voice. That waits for the session to take the voice and model first.
import { randomUUID } from 'node:crypto';
import type { SpeechConnector, SpeechRequest } from './connectors.ts';
import { socketSpeech, type SocketAddress, type SpeechMessage } from './kit/socketSpeech.ts';
import { errorOf, OpenAiRecognition, readEvent, type RealtimeHost } from './openai.ts';

export const INWORLD_ADAPTER = 'inworld';
export const INWORLD_ENDPOINT = 'wss://api.inworld.ai';
export const INWORLD_TRANSCRIPTION_MODEL = 'inworld/inworld-stt-1';
const SPEAKING_RATE = 24_000;

const json = (value: unknown) => JSON.stringify(value);

/** A fresh realtime session at Inworld. An https address is used as wss. The model is not part of it: the session names it. */
export function inworldAddress(_model: string, key: { reveal(): string }, base: string): SocketAddress {
    const root = base.replace(/^http(s?):\/\//i, 'ws$1://').replace(/\/+$/, '');
    return { url: `${root}/api/v1/realtime/session?key=${randomUUID()}&protocol=realtime`, headers: { authorization: `Basic ${key.reveal()}` } };
}

export const INWORLD_HOST: RealtimeHost = { adapter: INWORLD_ADAPTER, endpoint: INWORLD_ENDPOINT, connect: inworldAddress, transcriptionModel: INWORLD_TRANSCRIPTION_MODEL };

/** Hearing with Inworld: OpenAI's Realtime hearing, at Inworld. */
export class InworldRecognition extends OpenAiRecognition {
    constructor() {
        super(INWORLD_HOST);
    }
}

/** Speaking with Inworld: one socket per reply, the Mind's words spoken as they are by the key's TTS model, in the picked voice. */
export class InworldSpeech implements SpeechConnector {
    private readonly connector = socketSpeech({
        adapter: INWORLD_ADAPTER,
        endpoint: INWORLD_ENDPOINT,
        audio: { sampleRate: SPEAKING_RATE, encoding: 'base64' },
        connect: (request, base) => inworldAddress(request.settings.model, request.settings.key, base),
        start: (request) => [
            json({
                type: 'session.update',
                session: {
                    type: 'realtime',
                    output_modalities: ['audio'],
                    // No audio is ever sent, so its turn detection, left as it is, never starts a turn
                    audio: {
                        output: { format: { type: 'audio/pcm', rate: SPEAKING_RATE }, voice: request.settings.voiceId, model: request.settings.model },
                    },
                },
            }),
        ],
        // The words are spoken with the voice and model the session holds when they arrive, so they wait for it to take them
        ready: (data, isBinary) => readEvent(data, isBinary)?.type === 'session.updated',
        send: (request: SpeechRequest) => [json({ type: 'response.speak', text: request.text })],
        read: (data, isBinary): SpeechMessage | undefined => {
            const event = readEvent(data, isBinary);
            switch (event?.type) {
                case 'response.speak.acknowledged':
                    return event.accepted === false ? { error: {} } : undefined;
                case 'response.output_audio.delta':
                    return typeof event.delta === 'string' ? { audio: event.delta } : undefined;
                case 'response.done': {
                    const status = (event.response as { status?: unknown } | undefined)?.status;
                    return status === 'failed' ? { error: {} } : { done: true };
                }
                case 'error': {
                    const error = errorOf(event);
                    return error.harmless ? undefined : { error: { status: error.status } };
                }
                default:
                    return undefined;
            }
        },
    });

    speak(request: SpeechRequest): AsyncIterable<Int16Array> {
        return this.connector.speak(request);
    }
}
