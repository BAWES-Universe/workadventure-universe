// Hearing with OpenAI (#1900), on the shared kit (#1883), over the realtime socket in transcription mode as Pipecat's
// OpenAIRealtimeSTTService does. https://platform.openai.com/docs/guides/realtime-transcription
//
// Talking live with OpenAI is its own connector (src/openai.ts, #1917); this one only hears, and OpenAI's own speaking is not
// offered. The key goes as a bearer in the socket's opening request and nowhere else.
//
// The socket (wss://api.openai.com/v1/realtime?intent=transcription) is set up with session.update: 24 kHz PCM, the model, the
// language, and OpenAI's own turn detection off, so the worker says when a stretch ends. Audio waits for session.updated, then
// goes as base64 24 kHz in input_audio_buffer.append messages; input_audio_buffer.commit ends it. Each delta adds to the words so
// far, and the completed event that answers the commit holds the stretch's whole transcript.
import type { RecognitionConnector, RecognitionSettings } from './connectors.ts';
import { pcmBytes, Resampler } from './kit/pcm.ts';
import { baseLanguage } from './kit/signIn.ts';
import { socketHearing, type HearingMessage } from './kit/socketHearing.ts';
import type { Recognizer, RecognizerEvents } from './recognizer.ts';

export const OPENAI_ADAPTER = 'openai';
export const OPENAI_HEARING_ENDPOINT = 'wss://api.openai.com';
const HEARING_MODEL = 'gpt-realtime-whisper';
/** OpenAI's realtime socket takes 24 kHz audio. */
const OPENAI_RATE = 24000;

interface OpenAIAnswer {
    type?: unknown;
    delta?: unknown;
    transcript?: unknown;
    error?: unknown;
}

/** The status an OpenAI error reads as: from its code and type, and from its message only when they say nothing that maps. */
function openaiStatus(answer: OpenAIAnswer): number | undefined {
    const error = typeof answer.error === 'object' && answer.error !== null ? (answer.error as Record<string, unknown>) : {};
    // A rate limit's message can point to the billing page, so the message can't outrank the code
    return statusIn(`${String(error.code ?? '')} ${String(error.type ?? '')}`) ?? statusIn(String(error.message ?? ''));
}

function statusIn(text: string): number | undefined {
    if (/rate_limit|rate limit/i.test(text)) return 429;
    if (/invalid_api_key|unauthori[sz]ed|authentication/i.test(text)) return 401;
    if (/insufficient_quota|billing/i.test(text)) return 402;
    if (/model_not_found|permission|forbidden/i.test(text)) return 403;
    return undefined;
}

export class OpenAIRecognition implements RecognitionConnector {
    constructor(private readonly options: { finalTimeoutMs?: number } = {}) {}

    listen(settings: RecognitionSettings, events: RecognizerEvents): Recognizer {
        // Each stretch has its own words so far (deltas add up) and its own resampler
        let soFar = '';
        let finishing = false;
        const resampler = new Resampler(16000, OPENAI_RATE);
        return socketHearing({
            adapter: OPENAI_ADAPTER,
            endpoint: OPENAI_HEARING_ENDPOINT,
            finalTimeoutMs: this.options.finalTimeoutMs,
            connect: (settings: RecognitionSettings, base) => ({
                url: `${base}/v1/realtime?intent=transcription`,
                headers: { authorization: `Bearer ${settings.key.reveal()}` },
            }),
            start: (settings: RecognitionSettings) => {
                const language = settings.language ? baseLanguage(settings.language) : '';
                return [
                    JSON.stringify({
                        type: 'session.update',
                        session: {
                            type: 'transcription',
                            audio: {
                                input: {
                                    format: { type: 'audio/pcm', rate: OPENAI_RATE },
                                    transcription: { model: settings.model || HEARING_MODEL, ...(language ? { language } : {}) },
                                    turn_detection: null,
                                },
                            },
                        },
                    }),
                ];
            },
            readyFirst: true,
            frame: (pcm16k: Int16Array) => JSON.stringify({ type: 'input_audio_buffer.append', audio: pcmBytes(resampler.process(pcm16k)).toString('base64') }),
            finish: () => {
                finishing = true;
                return [JSON.stringify({ type: 'input_audio_buffer.commit' })];
            },
            read: (data, isBinary): HearingMessage | HearingMessage[] | undefined => {
                if (isBinary) return undefined;
                const answer = JSON.parse(data.toString()) as unknown;
                if (typeof answer !== 'object' || answer === null) return undefined;
                const event = answer as OpenAIAnswer;
                switch (event.type) {
                    case 'session.updated':
                    case 'transcription_session.updated':
                        return { ready: true };
                    case 'conversation.item.input_audio_transcription.delta':
                        if (typeof event.delta === 'string') soFar += event.delta;
                        return { interim: soFar.trim() };
                    case 'conversation.item.input_audio_transcription.completed': {
                        const text = typeof event.transcript === 'string' ? event.transcript.trim() : '';
                        soFar = '';
                        const words: HearingMessage = text ? { committed: text } : { interim: '' };
                        return finishing ? [words, { finished: true }] : words;
                    }
                    case 'conversation.item.input_audio_transcription.failed':
                    case 'error':
                        return { error: { status: openaiStatus(event) } };
                    default:
                        return undefined;
                }
            },
        }).listen(settings, events);
    }
}
