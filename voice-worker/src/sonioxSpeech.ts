// Speaking with Soniox (#1872), on the shared kit (#1883): Soniox's real-time TTS socket, one socket per reply. The key goes in
// the Authorization header of that one connection and nowhere else. The reply is one stream: its setup (model, voice, raw 24 kHz
// s16 audio, language), then the whole text with `text_end`. Audio comes back as base64 pieces, and `terminated` ends the reply.
// A failure is a message with `error_code`, which is the HTTP status (402 out of credit, 401 a refused key).
import type { SpeechConnector, SpeechRequest } from './connectors.ts';
import { baseLanguage } from './kit/signIn.ts';
import { SPEECH_RATE } from './kit/httpSpeech.ts';
import { socketSpeech, type SpeechMessage } from './kit/socketSpeech.ts';
import { SONIOX_ADAPTER } from './soniox.ts';

export const SONIOX_SPEECH_ENDPOINT = 'wss://tts-rt.soniox.com/tts-websocket';
/** One reply is one stream on its own socket, so its id never has to differ. */
const STREAM_ID = 'reply';
const DEFAULT_LANGUAGE = 'en';

interface SonioxSpeechAnswer {
    audio?: unknown;
    terminated?: unknown;
    error_code?: unknown;
}

export class SonioxSpeech implements SpeechConnector {
    private readonly connector = socketSpeech({
        adapter: SONIOX_ADAPTER,
        endpoint: SONIOX_SPEECH_ENDPOINT,
        audio: { sampleRate: SPEECH_RATE, encoding: 'base64' },
        connect: (request, base) => ({ url: base, headers: { authorization: `Bearer ${request.settings.key.reveal()}` } }),
        send: (request) => {
            const config = {
                stream_id: STREAM_ID,
                model: request.settings.model,
                voice: request.settings.voiceId,
                audio_format: 'pcm_s16le',
                sample_rate: SPEECH_RATE,
                // Soniox needs a language on every stream: English when neither the reply nor the profile names one
                language: baseLanguage(request.lang || request.settings.language || DEFAULT_LANGUAGE),
            };
            return [JSON.stringify(config), JSON.stringify({ text: request.text, text_end: true, stream_id: STREAM_ID })];
        },
        read: (data, isBinary): SpeechMessage | undefined => {
            if (isBinary) return undefined;
            const answer = JSON.parse(data.toString()) as SonioxSpeechAnswer;
            if (typeof answer !== 'object' || answer === null) return undefined;
            if (answer.error_code !== undefined && answer.error_code !== null) return { error: { status: typeof answer.error_code === 'number' ? answer.error_code : undefined } };
            return { audio: typeof answer.audio === 'string' && answer.audio ? answer.audio : undefined, done: answer.terminated === true };
        },
    });

    speak(request: SpeechRequest): AsyncIterable<Int16Array> {
        return this.connector.speak(request);
    }
}
