// The registry of speech providers. A bubble names its hearing and speaking providers by adapter name (the lowercase name
// Orbit stores, such as "soniox" or "elevenlabs") when the bot server opens its session, and the worker looks each one
// up here. A real provider is one small file that implements RecognitionConnector or SpeechConnector and is registered
// under its name; nothing else in the worker knows which providers exist.
import { inspect } from 'node:util';
import type { Expression } from './protocol.ts';
import type { Recognizer, RecognizerEvents } from './recognizer.ts';

/**
 * A provider key. It prints as a placeholder however it is logged, stringified or serialised, so it cannot end up in a
 * log line, an error message or a message to the bot server by accident. Only a connector calls `reveal()`, for the
 * provider call itself.
 */
export class Secret {
    readonly #value: string;

    constructor(value: string) {
        this.#value = value;
    }

    reveal(): string {
        return this.#value;
    }

    toString(): string {
        return '[secret]';
    }

    toJSON(): string {
        return '[secret]';
    }

    [inspect.custom](): string {
        return '[secret]';
    }
}

interface ProviderSettings {
    /** The adapter name the bubble asked for, lowercase. */
    adapter: string;
    model: string;
    key: Secret;
    endpoint?: string;
    region?: string;
    language?: string;
}
export type RecognitionSettings = ProviderSettings;
export interface SpeechSettings extends ProviderSettings {
    voiceId: string;
}

/**
 * What a connector throws (or fails with) when its provider call does not work. `status` is the provider's HTTP status
 * when it answered with one, and is left out for a timeout or a dropped connection. The message is for the connector's
 * own debugging: the worker never sends it anywhere, so even a message that names the key cannot leak it.
 */
export class ProviderError extends Error {
    constructor(message: string, readonly status?: number) {
        super(message);
        this.name = 'ProviderError';
    }
}

/** The provider's HTTP status of a failure, when it has one (any error with a numeric `status` counts). */
export function statusOf(error: unknown): number | undefined {
    const status = (error as { status?: unknown } | null)?.status;
    return typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined;
}

/** The provider refused the key itself. */
export const isRejection = (status: number | undefined): boolean => status === 401 || status === 403;

/** Hearing. One call per stretch of speech, fed 16 kHz mono audio, answering through `events` (see recognizer.ts). */
export interface RecognitionConnector {
    listen(settings: RecognitionSettings, events: RecognizerEvents): Recognizer;
}

export interface SpeechRequest {
    text: string;
    settings: SpeechSettings;
    /** The language of this reply when the bot server says so; otherwise `settings.language`. */
    lang?: string;
    expression?: Expression;
    /** Aborted when the reply is no longer wanted (talked over, retracted, voice stopped, time limit). Close the provider call then. */
    signal: AbortSignal;
}

/**
 * Speaking. Yields the reply as 24 kHz mono s16 audio in chunks of any size, as the provider produces them: the
 * worker starts playing the first chunk without waiting for the rest. Throw a ProviderError (with the HTTP status if the
 * provider gave one) when the call fails; whatever was already played stays played.
 */
export interface SpeechConnector {
    speak(request: SpeechRequest): AsyncIterable<Int16Array>;
}

/** Connectors by adapter name. Names are lowercase. */
export class ConnectorRegistry {
    private readonly hearing = new Map<string, RecognitionConnector>();
    private readonly speaking = new Map<string, SpeechConnector>();

    registerRecognition(adapter: string, connector: RecognitionConnector): this {
        this.hearing.set(adapter.toLowerCase(), connector);
        return this;
    }

    registerSpeech(adapter: string, connector: SpeechConnector): this {
        this.speaking.set(adapter.toLowerCase(), connector);
        return this;
    }

    recognition(adapter: string): RecognitionConnector | undefined {
        return this.hearing.get(adapter.toLowerCase());
    }

    speech(adapter: string): SpeechConnector | undefined {
        return this.speaking.get(adapter.toLowerCase());
    }
}

/** What the speaker speaks with: one bubble's chosen speech connector, with its settings already bound. */
export interface Voice {
    speak(request: { text: string; lang?: string; signal: AbortSignal }): AsyncIterable<Int16Array>;
}

/** Where a provider's outcomes go (the session turns them into messages to the bot server). */
export interface ProviderReporter {
    ok(): void;
    failed(status?: number): void;
}
