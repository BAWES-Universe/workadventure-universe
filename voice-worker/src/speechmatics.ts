// Hearing and speaking with Speechmatics (#1876), on the shared kit (#1883), as Pipecat's SpeechmaticsSTTService and
// SpeechmaticsTTSService do. https://docs.speechmatics.com
//
// The key goes as a bearer in each socket's opening request or each speaking request, and nowhere else.
//
// Hearing (Linden 1, wss://eu2.rt.speechmatics.com/v2/agent): StartRecognition sets the audio, the language and the model, with
// turns closed by the worker rather than by Speechmatics. Audio waits for RecognitionStarted and then goes as binary 16 kHz s16
// messages, each counted: EndOfStream names the last one. AddPartialSegment holds words that may still change, AddSegment
// settled ones, and EndOfTranscript says the last words came. An Error message ends the session.
//
// Speaking (preview, https://preview.tts.speechmatics.com/generate/{voice}): one request per reply, answered with raw 16 kHz s16
// PCM. Speechmatics names no model; its four voices speak English.
import type { RecognitionConnector, RecognitionSettings, SpeechConnector, SpeechRequest } from './connectors.ts';
import { httpSpeech } from './kit/httpSpeech.ts';
import { pcmBytes } from './kit/pcm.ts';
import { baseLanguage } from './kit/signIn.ts';
import { socketHearing, type HearingMessage } from './kit/socketHearing.ts';
import type { Recognizer, RecognizerEvents } from './recognizer.ts';

export const SPEECHMATICS_ADAPTER = 'speechmatics';
export const SPEECHMATICS_ENDPOINT = 'wss://eu2.rt.speechmatics.com';
export const SPEECHMATICS_SPEECH_ENDPOINT = 'https://preview.tts.speechmatics.com';
const HEARING_MODEL = 'linden-1';
const SPEECH_RATE = 16000;
const DEFAULT_VOICE = 'sarah';

/** The languages Speechmatics hears, by its own codes (Pipecat's list); Mandarin is "cmn" and Filipino "tl". */
const HEARS = new Set(
    'ar ba eu be bg bn yue ca hr cs da nl en eo et fa fi fr gl de el he hi hu it id ga ja ko lv lt ms mt cmn mr mn no pl pt ro ru sk sl es sv sw tl ta th tr ug uk ur vi cy'.split(
        ' ',
    ),
);
const ALIASES: Record<string, string> = { zh: 'cmn', fil: 'tl', iw: 'he', nb: 'no' };

/** The language Speechmatics is told to hear: its code for the person's language, or English for one it doesn't hear. */
export function speechmaticsLanguage(language: string | undefined): string {
    const base = language ? baseLanguage(language) : '';
    const code = ALIASES[base] ?? base;
    return HEARS.has(code) ? code : 'en';
}

/** The status a Speechmatics error type reads as. */
const STATUSES: Record<string, number> = {
    not_authorised: 401,
    insufficient_funds: 402,
    not_allowed: 403,
    quota_exceeded: 429,
    invalid_model: 400,
    invalid_config: 400,
    invalid_audio_type: 400,
    invalid_message: 400,
    protocol_error: 400,
    internal_error: 500,
    job_error: 500,
};

interface SpeechmaticsAnswer {
    message?: unknown;
    type?: unknown;
    segment?: { transcript?: unknown };
}

export class SpeechmaticsRecognition implements RecognitionConnector {
    constructor(private readonly options: { finalTimeoutMs?: number } = {}) {}

    listen(settings: RecognitionSettings, events: RecognizerEvents): Recognizer {
        // EndOfStream names the number of audio messages sent, so each stretch counts its own
        let sent = 0;
        return socketHearing({
            adapter: SPEECHMATICS_ADAPTER,
            endpoint: SPEECHMATICS_ENDPOINT,
            finalTimeoutMs: this.options.finalTimeoutMs,
            connect: (settings: RecognitionSettings, base) => ({
                url: `${base}/v2/agent?sm-app=universe`,
                headers: { authorization: `Bearer ${settings.key.reveal()}` },
            }),
            start: (settings: RecognitionSettings) => [
                JSON.stringify({
                    message: 'StartRecognition',
                    audio_format: { type: 'raw', encoding: 'pcm_s16le', sample_rate: 16000 },
                    transcription_config: {
                        language: speechmaticsLanguage(settings.language),
                        model: settings.model || HEARING_MODEL,
                        enable_partials: true,
                    },
                    // The worker says when a stretch ends, as Pipecat does with its own endpointing
                    turn_config: { turn_detection_mode: 'external' },
                }),
            ],
            readyFirst: true,
            frame: (pcm16k: Int16Array) => {
                sent++;
                return pcmBytes(pcm16k);
            },
            finish: () => [JSON.stringify({ message: 'ForceEndOfUtterance' }), JSON.stringify({ message: 'EndOfStream', last_seq_no: sent })],
            read: (data, isBinary): HearingMessage | undefined => {
                if (isBinary) return undefined;
                const answer = JSON.parse(data.toString()) as unknown;
                if (typeof answer !== 'object' || answer === null) return undefined;
                const { message, type, segment } = answer as SpeechmaticsAnswer;
                const transcript = typeof segment?.transcript === 'string' ? segment.transcript.trim() : '';
                switch (message) {
                    case 'RecognitionStarted':
                        return { ready: true };
                    case 'AddPartialSegment':
                        return { interim: transcript };
                    case 'AddSegment':
                        return transcript ? { committed: transcript } : { interim: '' };
                    case 'EndOfTranscript':
                        return { finished: true };
                    case 'Error':
                        return { error: { status: typeof type === 'string' ? STATUSES[type] : undefined } };
                    default:
                        return undefined;
                }
            },
        }).listen(settings, events);
    }
}

export class SpeechmaticsSpeech implements SpeechConnector {
    private readonly connector = httpSpeech({
        adapter: SPEECHMATICS_ADAPTER,
        endpoint: SPEECHMATICS_SPEECH_ENDPOINT,
        audio: { kind: 'raw', sampleRate: SPEECH_RATE },
        call: (request: SpeechRequest) => ({
            url: `/generate/${encodeURIComponent(request.settings.voiceId || DEFAULT_VOICE)}?output_format=pcm_${SPEECH_RATE}&sm-app=universe`,
            headers: {
                authorization: `Bearer ${request.settings.key.reveal()}`,
                'content-type': 'application/json',
            },
            body: JSON.stringify({ text: request.text }),
        }),
    });

    speak(request: SpeechRequest): AsyncIterable<Int16Array> {
        return this.connector.speak(request);
    }
}
