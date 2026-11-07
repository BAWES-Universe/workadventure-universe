// xAI's Grok Voice (game #1910), a talking model on the shared kit (#1883), used the same way as OpenAI's (openai.ts): it hears and
// it speaks, and the bot's own Mind writes every answer. Its socket speaks the same Realtime events as OpenAI's, with these
// differences, from xAI's voice agent docs (Nov 2026):
//
// - Hearing: xAI's turn detection has no switch to stop it answering, so it is off (`turn_detection: null`) and the audio is
//   committed once, when the stretch ends; nothing is ever asked to answer. The worker's own pause detection ends a stretch.
//   The words come from `grok-transcribe`: `...transcription.updated` carries everything heard so far (not a piece), and
//   `...transcription.completed` the last words. It takes 16 kHz audio as it is, so nothing is resampled.
// - Speaking: out-of-band replies are not in xAI's docs, so the Mind's words go in as the one item of a fresh socket's
//   conversation (one socket per reply, nothing else in it), then one response is asked for. Reasoning is off: it only reads.
//
// The key goes in the Authorization header of the socket and nowhere else.
import type { RecognitionConnector, RecognitionSettings, SpeechConnector, SpeechRequest } from './connectors.ts';
import type { Recognizer, RecognizerEvents } from './recognizer.ts';
import { pcmBytes } from './kit/pcm.ts';
import { baseLanguage } from './kit/signIn.ts';
import { socketHearing } from './kit/socketHearing.ts';
import { socketSpeech, type SpeechMessage } from './kit/socketSpeech.ts';
import { errorOf, LISTEN_ONLY, READ_ALOUD, readEvent, realtimeAddress, TONE } from './openai.ts';

export const XAI_ADAPTER = 'xai';
export const XAI_ENDPOINT = 'wss://api.x.ai';
/** The model that writes down what the person said, inside the session. */
export const XAI_TRANSCRIPTION_MODEL = 'grok-transcribe';
const HEARING_RATE = 16_000;
const SPEAKING_RATE = 24_000;

const json = (value: unknown) => JSON.stringify(value);

/** The language hint xAI takes: the base language, except Spanish and Portuguese, which it needs with their region. */
export function xaiLanguageHint(language: string): string {
    const base = baseLanguage(language);
    return (base === 'es' || base === 'pt') && /[-_]/.test(language) ? language.replace('_', '-') : base;
}

/** Hearing with Grok Voice: one socket per stretch of speech, committed once at its end. */
export class XaiRecognition implements RecognitionConnector {
    listen(settings: RecognitionSettings, events: RecognizerEvents): Recognizer {
        let finishing = false;
        return socketHearing({
            adapter: XAI_ADAPTER,
            endpoint: XAI_ENDPOINT,
            connect: (s, base) => realtimeAddress(s.model, s.key, base),
            start: (s) => [
                json({
                    type: 'session.update',
                    session: {
                        instructions: LISTEN_ONLY,
                        // No turn detection: it would answer each turn. The audio is committed when the stretch ends
                        turn_detection: null,
                        audio: {
                            input: {
                                format: { type: 'audio/pcm', rate: HEARING_RATE },
                                transcription: {
                                    model: XAI_TRANSCRIPTION_MODEL,
                                    ...(s.language ? { language_hint: xaiLanguageHint(s.language) } : {}),
                                },
                            },
                        },
                    },
                }),
            ],
            frame: (pcm16k) => json({ type: 'input_audio_buffer.append', audio: pcmBytes(pcm16k).toString('base64') }),
            finish: () => {
                finishing = true;
                return [json({ type: 'input_audio_buffer.commit' })];
            },
            read: (data, isBinary) => {
                const event = readEvent(data, isBinary);
                switch (event?.type) {
                    // Everything heard so far, not a piece: it replaces what may still change
                    case 'conversation.item.input_audio_transcription.updated':
                        return { interim: typeof event.transcript === 'string' ? event.transcript.trim() : '' };
                    case 'conversation.item.input_audio_transcription.completed': {
                        const transcript = typeof event.transcript === 'string' ? event.transcript.trim() : '';
                        return [{ ...(transcript ? { committed: transcript } : {}), interim: '' }, ...(finishing ? [{ finished: true }] : [])];
                    }
                    case 'conversation.item.input_audio_transcription.failed':
                        return { error: {} };
                    case 'error': {
                        const error = errorOf(event);
                        // Nothing to commit: the person said nothing the model kept. The stretch ends with nothing heard
                        if (error.harmless) return finishing ? { finished: true } : undefined;
                        return { error: { status: error.status } };
                    }
                    default:
                        return undefined;
                }
            },
        }).listen(settings, events);
    }
}

/** Speaking with Grok Voice: one socket per reply, the Mind's words the one item it reads aloud. */
export class XaiSpeech implements SpeechConnector {
    private readonly connector = socketSpeech({
        adapter: XAI_ADAPTER,
        endpoint: XAI_ENDPOINT,
        audio: { sampleRate: SPEAKING_RATE, encoding: 'base64' },
        connect: (request, base) => realtimeAddress(request.settings.model, request.settings.key, base),
        send: (request) => [
            json({
                type: 'session.update',
                session: {
                    instructions: `${READ_ALOUD} ${TONE[request.expression ?? 'natural']}`,
                    voice: request.settings.voiceId,
                    // It only reads: no thinking first, and no listening for a turn
                    reasoning: { effort: 'none' },
                    turn_detection: null,
                    audio: { output: { format: { type: 'audio/pcm', rate: SPEAKING_RATE } } },
                },
            }),
            json({
                type: 'conversation.item.create',
                item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: request.text }] },
            }),
            json({ type: 'response.create' }),
        ],
        read: (data, isBinary): SpeechMessage | undefined => {
            const event = readEvent(data, isBinary);
            switch (event?.type) {
                case 'response.output_audio.delta':
                case 'response.audio.delta':
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
