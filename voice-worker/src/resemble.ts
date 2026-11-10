// Speaking with Resemble AI (#1901), on the shared kit (#1883): one streamed request per reply to Resemble's synthesis server
// (POST https://f.cluster.resemble.ai/stream). Pipecat's ResembleAITTSService uses Resemble's socket instead, which Resemble
// keeps to Business plans; this call is open to every plan. https://docs.resemble.ai
//
// The key goes as a bearer in that one request and nowhere else. The answer is one 16-bit WAV, streamed: its header carries
// timestamp chunks before the samples, which are skipped. 48 kHz (Resemble's own default) is brought to the worker's 24 kHz.
// Resemble needs a voice; the voice sets the model.
import type { SpeechConnector, SpeechRequest } from './connectors.ts';
import { httpSpeech } from './kit/httpSpeech.ts';

export const RESEMBLE_ADAPTER = 'resemble';
export const RESEMBLE_ENDPOINT = 'https://f.cluster.resemble.ai';
export const RESEMBLE_SAMPLE_RATE = 48_000;
/** Resemble takes up to 2,000 characters a request. */
export const RESEMBLE_MAX_TEXT = 2_000;

export class ResembleSpeech implements SpeechConnector {
    private readonly connector = httpSpeech({
        adapter: RESEMBLE_ADAPTER,
        endpoint: RESEMBLE_ENDPOINT,
        audio: {
            kind: 'raw',
            sampleRate: RESEMBLE_SAMPLE_RATE,
            mayStartWithWav: true,
        },
        call: (request: SpeechRequest) => ({
            url: '/stream',
            headers: {
                authorization: `Bearer ${request.settings.key.reveal()}`,
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                voice_uuid: request.settings.voiceId,
                data: request.text.slice(0, RESEMBLE_MAX_TEXT),
                precision: 'PCM_16',
                sample_rate: RESEMBLE_SAMPLE_RATE,
            }),
        }),
    });

    speak(request: SpeechRequest): AsyncIterable<Int16Array> {
        return this.connector.speak(request);
    }
}
