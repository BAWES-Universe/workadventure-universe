// Speaking with Deepgram (#1879), on the shared kit (#1883): one streamed request per reply to /v1/speak, asking for raw 24 kHz
// mono s16 PCM (`linear16`, no container) so the audio plays as it arrives. The key goes in the Authorization header (`Token`) of
// that one request and nowhere else. A Deepgram voice is its own model (`aura-2-thalia-en`): the voice picked is what is sent as
// `model`, and the profile's model (the family, such as `aura-2`) is used only when no voice is set. The voice sets the language.
import type { SpeechConnector, SpeechRequest } from './connectors.ts';
import { DEEPGRAM_ADAPTER } from './deepgram.ts';
import { httpSpeech, SPEECH_RATE } from './kit/httpSpeech.ts';

export const DEEPGRAM_SPEECH_ENDPOINT = 'https://api.deepgram.com';

export class DeepgramSpeech implements SpeechConnector {
    private readonly connector = httpSpeech({
        adapter: DEEPGRAM_ADAPTER,
        endpoint: DEEPGRAM_SPEECH_ENDPOINT,
        audio: { kind: 'raw', sampleRate: SPEECH_RATE },
        call: (request) => {
            const { settings } = request;
            const query = new URLSearchParams({ model: settings.voiceId || settings.model, encoding: 'linear16', sample_rate: String(SPEECH_RATE), container: 'none' });
            return {
                url: `/v1/speak?${query}`,
                headers: { authorization: `Token ${settings.key.reveal()}`, 'content-type': 'application/json' },
                body: JSON.stringify({ text: request.text }),
            };
        },
    });

    speak(request: SpeechRequest): AsyncIterable<Int16Array> {
        return this.connector.speak(request);
    }
}
