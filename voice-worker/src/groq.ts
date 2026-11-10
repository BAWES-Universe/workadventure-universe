// Hearing and speaking with Groq (#1885), as Pipecat's Groq services do: Groq's OpenAI-style audio API, with the key as a bearer
// in the Authorization header of each request and nowhere else. https://console.groq.com/docs/speech-to-text and /text-to-speech
//
// Hearing, on the shared upload kit (#1883): Groq's Whisper takes a whole file, so each stretch of speech is sent as one 16 kHz
// WAV when the person pauses, and the words come back in the answer.
// Speaking: Canopy Labs' Orpheus, one model for English and one for Saudi Arabic. A voice belongs to one of them, so a voice
// Groq names is spoken with its own model. Groq takes at most 200 characters a request, so a longer reply is spoken piece by
// piece, split between sentences, then words. Each answer is a WAV file, read whole and turned into 24 kHz samples.
import type { RecognitionConnector, RecognitionSettings, SpeechConnector, SpeechRequest } from './connectors.ts';
import { answerStatus, failure, readSome } from './kit/errors.ts';
import { SPEECH_RATE } from './kit/httpSpeech.ts';
import { Resampler } from './kit/pcm.ts';
import { baseLanguage } from './kit/signIn.ts';
import { uploadHearing } from './kit/uploadHearing.ts';
import type { Recognizer, RecognizerEvents } from './recognizer.ts';

export const GROQ_ADAPTER = 'groq';
export const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1';
export const GROQ_MAX_TEXT = 200;
const ENGLISH_MODEL = 'canopylabs/orpheus-v1-english';
const ARABIC_MODEL = 'canopylabs/orpheus-arabic-saudi';
const ENGLISH_VOICES = new Set(['autumn', 'diana', 'hannah', 'austin', 'daniel', 'troy']);
const ARABIC_VOICES = new Set(['abdullah', 'fahad', 'sultan', 'lulwa', 'noura', 'aisha']);
/** A WAV answer larger than this is not read: 200 characters of speech is far smaller. */
const MAX_WAV_BYTES = 16 * 1024 * 1024;

/** The model a voice is spoken with: its own when Groq names it, else the profile's; and a voice for a model with none picked. */
export function groqVoice(model: string, voiceId: string): { model: string; voice: string } {
    const voice = voiceId.toLowerCase();
    if (ARABIC_VOICES.has(voice)) return { model: ARABIC_MODEL, voice };
    if (ENGLISH_VOICES.has(voice)) return { model: ENGLISH_MODEL, voice };
    if (voice) return { model, voice: voiceId };
    return { model, voice: model === ARABIC_MODEL ? 'abdullah' : 'autumn' };
}

/** The reply in pieces of at most `max` characters: whole sentences where they fit, then whole words, then cut. */
export function groqPieces(text: string, max = GROQ_MAX_TEXT): string[] {
    const pieces: string[] = [];
    let current = '';
    const add = (part: string) => {
        if (!part) return;
        if (!current) current = part;
        else if (current.length + 1 + part.length <= max) current += ` ${part}`;
        else {
            pieces.push(current);
            current = part;
        }
    };
    for (const sentence of text.replace(/\s+/g, ' ').trim().split(/(?<=[.!?؟…])\s+/)) {
        if (sentence.length <= max) {
            add(sentence);
            continue;
        }
        for (const word of sentence.split(' ')) {
            for (let at = 0; at < word.length; at += max) add(word.slice(at, at + max));
        }
    }
    if (current) pieces.push(current);
    return pieces;
}

/** The 16-bit mono samples and their rate in a WAV file, read by its chunks. */
export function readWav(bytes: Uint8Array): { samples: Int16Array; sampleRate: number } {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tag = (at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
    if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file');
    let at = 12;
    let sampleRate = 0;
    while (at + 8 <= bytes.length) {
        const id = tag(at);
        const size = view.getUint32(at + 4, true);
        const body = at + 8;
        if (id === 'fmt ') {
            const format = view.getUint16(body, true);
            const channels = view.getUint16(body + 2, true);
            const bits = view.getUint16(body + 14, true);
            if (format !== 1 || channels !== 1 || bits !== 16) throw new Error('not 16-bit mono PCM');
            sampleRate = view.getUint32(body + 4, true);
        } else if (id === 'data') {
            if (!sampleRate) throw new Error('data before its format');
            // A streamed WAV may give its data no length (0 or 0xFFFFFFFF): it runs to the end of the file
            const end = size === 0 || body + size > bytes.length ? bytes.length : body + size;
            const length = Math.floor((end - body) / 2);
            const samples = new Int16Array(length);
            for (let i = 0; i < length; i++) samples[i] = view.getInt16(body + i * 2, true);
            return { samples, sampleRate };
        }
        at = body + size + (size % 2);
    }
    throw new Error('no audio in the WAV file');
}

export class GroqRecognition implements RecognitionConnector {
    private readonly connector = uploadHearing({
        adapter: GROQ_ADAPTER,
        endpoint: GROQ_ENDPOINT,
        request: (settings: RecognitionSettings, wav: Uint8Array) => {
            const form = new FormData();
            form.append('file', new Blob([wav], { type: 'audio/wav' }), 'audio.wav');
            form.append('model', settings.model);
            form.append('response_format', 'json');
            if (settings.language) form.append('language', baseLanguage(settings.language));
            return { url: '/audio/transcriptions', headers: { authorization: `Bearer ${settings.key.reveal()}` }, body: form };
        },
        read: (answer) => {
            const text = typeof answer === 'object' && answer !== null ? (answer as { text?: unknown }).text : undefined;
            if (typeof text !== 'string') throw failure(GROQ_ADAPTER, 'sent an answer without words');
            return text;
        },
    });

    listen(settings: RecognitionSettings, events: RecognizerEvents): Recognizer {
        return this.connector.listen(settings, events);
    }
}

export class GroqSpeech implements SpeechConnector {
    async *speak(request: SpeechRequest): AsyncGenerator<Int16Array> {
        const base = (request.settings.endpoint || GROQ_ENDPOINT).replace(/\/+$/, '');
        const { model, voice } = groqVoice(request.settings.model, request.settings.voiceId);
        const resamplers = new Map<number, Resampler>();
        for (const piece of groqPieces(request.text)) {
            if (request.signal.aborted) return;
            let response: Response;
            try {
                response = await fetch(`${base}/audio/speech`, {
                    method: 'POST',
                    headers: { authorization: `Bearer ${request.settings.key.reveal()}`, 'content-type': 'application/json' },
                    body: JSON.stringify({ model, voice, input: piece, response_format: 'wav' }),
                    signal: request.signal,
                    redirect: 'manual',
                });
            } catch {
                if (request.signal.aborted) return;
                throw failure(GROQ_ADAPTER, 'could not be reached');
            }
            if (!response.ok) throw failure(GROQ_ADAPTER, 'refused the reply', answerStatus(response.status, await readSome(response.body)));
            let wav: { samples: Int16Array; sampleRate: number };
            try {
                const length = Number(response.headers.get('content-length') ?? 0);
                if (length > MAX_WAV_BYTES) throw new Error('too large');
                const bytes = new Uint8Array(await response.arrayBuffer());
                if (bytes.length > MAX_WAV_BYTES) throw new Error('too large');
                wav = readWav(bytes);
            } catch {
                if (request.signal.aborted) return;
                throw failure(GROQ_ADAPTER, 'sent audio that could not be read');
            }
            if (request.signal.aborted) return;
            let resampler = resamplers.get(wav.sampleRate);
            if (!resampler && wav.sampleRate !== SPEECH_RATE) {
                resampler = new Resampler(wav.sampleRate, SPEECH_RATE);
                resamplers.set(wav.sampleRate, resampler);
            }
            const ready = resampler ? resampler.process(wav.samples) : wav.samples;
            if (ready.length > 0) yield ready;
        }
    }
}
