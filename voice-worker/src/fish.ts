// Speaking with Fish Audio (#1868), on the shared kit (#1883): one streamed request per reply to /v1/tts, asking for raw 24 kHz mono s16 PCM so the
// audio plays as it arrives with nothing to decode. The key goes in the Authorization header of that one request and
// nowhere else. The model (`s2.1-pro`, or the free `s2.1-pro-free`) goes in the `model` header and the voice in `reference_id`.
import type { SpeechConnector, SpeechRequest } from './connectors.ts';
import { httpSpeech, SPEECH_RATE } from './kit/httpSpeech.ts';
import { baseLanguage } from './kit/signIn.ts';

export const FISH_ADAPTER = 'fish';
export const FISH_ENDPOINT = 'https://api.fish.audio';

export class FishSpeech implements SpeechConnector {
    private readonly connector = httpSpeech({
        adapter: FISH_ADAPTER,
        endpoint: FISH_ENDPOINT,
        // The docs do not say whether `pcm` carries a WAV header, so one that does is skipped rather than played as a click
        audio: { kind: 'raw', sampleRate: SPEECH_RATE, mayStartWithWav: true },
        call: (request) => {
            const { settings } = request;
            const body: Record<string, unknown> = {
                text: request.text,
                reference_id: settings.voiceId,
                format: 'pcm',
                sample_rate: SPEECH_RATE,
                // Lower latency than the default, which favours quality: a reply is heard as it is made
                latency: 'balanced',
            };
            // Only used for reading numbers and dates aloud, so a base code such as `ar` is all it needs
            const lang = request.lang ?? settings.language;
            if (lang) body.language = baseLanguage(lang);
            return {
                url: '/v1/tts',
                headers: { authorization: `Bearer ${settings.key.reveal()}`, model: settings.model, 'content-type': 'application/json' },
                body: JSON.stringify(body),
            };
        },
    });

    speak(request: SpeechRequest): AsyncIterable<Int16Array> {
        return this.connector.speak(request);
    }
}
