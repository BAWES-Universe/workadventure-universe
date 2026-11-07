// Google's Gemini Live (game #1910), a talking model on the shared kit (#1883): it hears and it speaks, and the bot's own Mind
// writes every answer. From Google's Live API docs and Pipecat's Gemini Live service (Nov 2026):
//
// - One socket per stretch of speech, and one per reply, to the BidiGenerateContent socket. The key goes in the
//   `x-goog-api-key` header and nowhere else. The first message is the setup; nothing else is sent until Google answers it with
//   `setupComplete`. Google sends its JSON in binary frames as often as in text ones.
// - Hearing: Gemini Live has no way to only listen. Its own turn detection is off, so the person's speech is marked by the
//   worker (activityStart, then activityEnd when the stretch ends) and it never answers mid-stretch. After activityEnd it
//   starts an answer nobody hears: that answer is cut to one token (`maxOutputTokens: 1`), and the stretch ends with the turn.
//   The words come from the input transcription, in pieces, sent apart from the turn in no set order: the stretch ends once
//   nothing more has come for a moment after the turn.
// - Speaking: the Mind's words go in as the one text of a fresh session, told to read them aloud exactly, in the picked voice.
//   Audio comes back at 24 kHz, the worker's own rate.
import type { RecognitionConnector, RecognitionSettings, SpeechConnector, SpeechRequest } from './connectors.ts';
import type { Recognizer, RecognizerEvents } from './recognizer.ts';
import { pcmBytes } from './kit/pcm.ts';
import { socketHearing } from './kit/socketHearing.ts';
import { socketSpeech, type SocketAddress, type SpeechMessage } from './kit/socketSpeech.ts';
import { LISTEN_ONLY, READ_ALOUD, TONE } from './openai.ts';

export const GOOGLE_ADAPTER = 'google';
export const GOOGLE_ENDPOINT = 'wss://generativelanguage.googleapis.com';
const LIVE_PATH = '/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const HEARING_RATE = 16_000;
const SPEAKING_RATE = 24_000;
/** How long to wait for words after the turn ends, when no more have come. */
const SETTLE_MS = 400;

const json = (value: unknown) => JSON.stringify(value);

/** The Live socket for a key. An https address is used as wss. */
export function liveAddress(key: { reveal(): string }, base: string): SocketAddress {
    const root = base.replace(/^http(s?):\/\//i, 'ws$1://').replace(/\/+$/, '');
    return { url: `${root}${LIVE_PATH}`, headers: { 'x-goog-api-key': key.reveal() } };
}

/** Google's model name, with the `models/` it asks for. */
const modelName = (model: string) => (model.startsWith('models/') ? model : `models/${model}`);

/** One message from Google, from a text or a binary frame. */
export function readLive(data: Buffer): Record<string, unknown> | undefined {
    const value: unknown = JSON.parse(data.toString('utf8'));
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

const isSetupComplete = (data: Buffer): boolean => {
    try {
        return readLive(data)?.setupComplete !== undefined;
    } catch {
        return false;
    }
};

/** What a server message holds that the worker reads. */
function serverContent(message: Record<string, unknown> | undefined) {
    const content = (message?.serverContent ?? {}) as {
        inputTranscription?: { text?: unknown };
        modelTurn?: { parts?: { inlineData?: { data?: unknown; mimeType?: unknown } }[] };
        turnComplete?: unknown;
    };
    const heard = typeof content.inputTranscription?.text === 'string' ? content.inputTranscription.text : '';
    const audio = (content.modelTurn?.parts ?? []).map((part) => part.inlineData?.data).filter((data): data is string => typeof data === 'string');
    return { heard, audio, turnComplete: content.turnComplete === true };
}

/** Hearing with Gemini Live: one socket per stretch of speech, which the worker marks out itself. */
export class GoogleRecognition implements RecognitionConnector {
    listen(settings: RecognitionSettings, events: RecognizerEvents): Recognizer {
        let finishing = false;
        return socketHearing({
            adapter: GOOGLE_ADAPTER,
            endpoint: GOOGLE_ENDPOINT,
            join: 'tokens',
            // Google sends the transcription apart from the turn, in no set order: words can still come after turnComplete
            settleMs: SETTLE_MS,
            connect: (s, base) => liveAddress(s.key, base),
            start: (s) => [
                json({
                    setup: {
                        model: modelName(s.model),
                        // It can't be told to only listen: whatever it starts after the stretch is cut to one token, and never played
                        generationConfig: { responseModalities: ['AUDIO'], maxOutputTokens: 1 },
                        systemInstruction: { parts: [{ text: LISTEN_ONLY }] },
                        inputAudioTranscription: {},
                        realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
                    },
                }),
            ],
            ready: (data) => isSetupComplete(data),
            afterReady: () => [json({ realtimeInput: { activityStart: {} } })],
            frame: (pcm16k) => json({ realtimeInput: { audio: { mimeType: `audio/pcm;rate=${HEARING_RATE}`, data: pcmBytes(pcm16k).toString('base64') } } }),
            finish: () => {
                finishing = true;
                return [json({ realtimeInput: { activityEnd: {} } })];
            },
            read: (data) => {
                const message = readLive(data);
                if (message?.error !== undefined) return { error: {} };
                const { heard, turnComplete } = serverContent(message);
                return [...(heard ? [{ committed: heard }] : []), ...(turnComplete && finishing ? [{ finished: true }] : [])];
            },
        }).listen(settings, events);
    }
}

/** Speaking with Gemini Live: one socket per reply, the Mind's words its one text, read aloud in the picked voice. */
export class GoogleSpeech implements SpeechConnector {
    private readonly connector = socketSpeech({
        adapter: GOOGLE_ADAPTER,
        endpoint: GOOGLE_ENDPOINT,
        audio: { sampleRate: SPEAKING_RATE, encoding: 'base64' },
        connect: (request, base) => liveAddress(request.settings.key, base),
        start: (request) => [
            json({
                setup: {
                    model: modelName(request.settings.model),
                    generationConfig: {
                        responseModalities: ['AUDIO'],
                        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: request.settings.voiceId } } },
                    },
                    systemInstruction: { parts: [{ text: `${READ_ALOUD} ${TONE[request.expression ?? 'natural']}` }] },
                },
            }),
        ],
        ready: (data) => isSetupComplete(data),
        // The text is the turn; its own turn detection, on by default, answers it
        send: (request) => [json({ realtimeInput: { text: request.text } })],
        read: (data): SpeechMessage | undefined => {
            const message = readLive(data);
            if (message?.error !== undefined) return { error: {} };
            const { audio, turnComplete } = serverContent(message);
            // Each piece is its own base64: decoded one by one, never joined as text
            if (audio.length > 0) return { audio: Buffer.concat(audio.map((piece) => Buffer.from(piece, 'base64'))), ...(turnComplete ? { done: true } : {}) };
            return turnComplete ? { done: true } : undefined;
        },
    });

    speak(request: SpeechRequest): AsyncIterable<Int16Array> {
        return this.connector.speak(request);
    }
}
