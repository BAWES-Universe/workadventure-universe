// Hearing with fal (#1885), on the shared kit (#1883): fal's Whisper apps take a whole file, not a live stream, so each stretch
// of speech is sent as one 16 kHz WAV when the person pauses, the way Pipecat's FalSTTService does. The file goes in the request
// itself as a data address, so it is never stored at fal first. https://fal.ai/models/fal-ai/wizper/api
//
// The model is the fal app the file goes to ("fal-ai/wizper"), at fal's run address. The key goes in the Authorization header
// (`Key`) of that one request and nowhere else. With no language set, fal works out the language itself.
import type { RecognitionConnector, RecognitionSettings } from './connectors.ts';
import { failure } from './kit/errors.ts';
import { baseLanguage } from './kit/signIn.ts';
import { uploadHearing } from './kit/uploadHearing.ts';
import type { Recognizer, RecognizerEvents } from './recognizer.ts';

export const FAL_ADAPTER = 'fal';
export const FAL_ENDPOINT = 'https://fal.run';
/** A fal app id: an owner and an app, each plain letters, digits, dots, dashes and underscores ("fal-ai/wizper"). */
const APP_ID = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)+$/;

export class FalRecognition implements RecognitionConnector {
    private readonly connector = uploadHearing({
        adapter: FAL_ADAPTER,
        endpoint: FAL_ENDPOINT,
        request: (settings: RecognitionSettings, wav: Uint8Array) => {
            if (!APP_ID.test(settings.model) || settings.model.split('/').includes('..')) throw failure(FAL_ADAPTER, 'was given a model that is not a fal app');
            return {
                url: `/${settings.model}`,
                headers: { authorization: `Key ${settings.key.reveal()}`, 'content-type': 'application/json' },
                body: JSON.stringify({
                    audio_url: `data:audio/wav;base64,${Buffer.from(wav).toString('base64')}`,
                    task: 'transcribe',
                    language: settings.language ? baseLanguage(settings.language) : null,
                    chunk_level: 'segment',
                }),
            };
        },
        read: (answer) => {
            const text = typeof answer === 'object' && answer !== null ? (answer as { text?: unknown }).text : undefined;
            if (typeof text !== 'string') throw failure(FAL_ADAPTER, 'sent an answer without words');
            return text;
        },
    });

    listen(settings: RecognitionSettings, events: RecognizerEvents): Recognizer {
        return this.connector.listen(settings, events);
    }
}
