// One company, two kinds of model under one adapter (#1910): a company that talks live (OpenAI, xAI) can also hear or speak
// with models of its own, each kind with its own connector. The models the dedicated connector serves go to it, a call that
// names no model too, and every other model to the connector already registered (the talking one), when there is one.
import type { RecognitionConnector, RecognitionSettings, SpeechConnector, SpeechRequest, SpeechSettings } from '../connectors.ts';
import type { RecognizerEvents } from '../recognizer.ts';

const pick = <T>(models: ReadonlySet<string>, model: string, own: T, other: T | undefined): T => (!model || models.has(model) || !other ? own : other);

/** Hearing for `models` by `own`, any other model by `other`. */
export function recognitionByModel(models: ReadonlySet<string>, own: RecognitionConnector, other: RecognitionConnector | undefined): RecognitionConnector {
    if (!other) return own;
    return {
        listen: (settings: RecognitionSettings, events: RecognizerEvents) => pick(models, settings.model, own, other).listen(settings, events),
    };
}

/** Speaking with `models` by `own`, any other model by `other`. */
export function speechByModel(models: ReadonlySet<string>, own: SpeechConnector, other: SpeechConnector | undefined): SpeechConnector {
    if (!other) return own;
    const of = (settings: SpeechSettings) => pick(models, settings.model, own, other);
    return {
        speak: (request: SpeechRequest) => of(request.settings).speak(request),
        prepare: (request) => of(request.settings).prepare?.(request),
        release: (settings) => of(settings).release?.(settings),
    };
}
