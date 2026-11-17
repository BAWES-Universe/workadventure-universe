// Speaking with Bland (#1885), on the shared kit (#1883): one streamed request per reply to Bland's /v2/tts, asking for raw
// 24 kHz mono s16 PCM so the audio plays as it arrives. https://docs.bland.ai/api-v2/post/tts
//
// The key goes in the Authorization header (`Bearer`) of that one request and nowhere else. A Bland voice sets its own model
// (BTTS v3 or v2), so the profile's model is not sent. Bland needs a voice on every reply: Karen, one of Bland's own built-in
// voices, when none is picked. Bland's statuses are plain HTTP ones (402 out of credit, 429 too many at once).
import type { SpeechConnector, SpeechRequest } from './connectors.ts';
import { httpSpeech, SPEECH_RATE } from './kit/httpSpeech.ts';

export const BLAND_ADAPTER = 'bland';
export const BLAND_ENDPOINT = 'https://api.bland.ai';
/** Karen, a Bland built-in voice (https://docs.bland.ai/tts/voices), used when no voice is picked. */
export const BLAND_DEFAULT_VOICE = '29158307-9893-4149-8a75-bc9ce313d64e';

export class BlandSpeech implements SpeechConnector {
    private readonly connector = httpSpeech({
        adapter: BLAND_ADAPTER,
        endpoint: BLAND_ENDPOINT,
        audio: { kind: 'raw', sampleRate: SPEECH_RATE },
        call: (request) => ({
            url: '/v2/tts',
            headers: { authorization: `Bearer ${request.settings.key.reveal()}`, 'content-type': 'application/json' },
            body: JSON.stringify({
                text: request.text,
                voice: request.settings.voiceId || BLAND_DEFAULT_VOICE,
                audio: { encoding: 'pcm_s16le', sample_rate: SPEECH_RATE, container: 'raw' },
            }),
        }),
    });

    speak(request: SpeechRequest): AsyncIterable<Int16Array> {
        return this.connector.speak(request);
    }
}
