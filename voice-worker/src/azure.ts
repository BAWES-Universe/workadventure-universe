// Azure OpenAI's realtime models (game #1910): the same Realtime API as OpenAI's (openai.ts), on the person's own Azure resource.
// A bot on one names `azure` for both hearing and speaking, with the deployment name as its model; its own Mind still writes
// every answer. What differs from OpenAI, from Azure's realtime docs (Nov 2026):
//
// - The address is the person's own resource (the key's endpoint, from Orbit): wss://<resource>/openai/v1/realtime?model=<deployment>.
//   There is no address to fall back on: a key without one can't be reached.
// - The key goes in the `api-key` header, and nowhere else.
// - Words are written down by gpt-4o-transcribe, a transcription model Azure runs inside the session.
import type { SocketAddress } from './kit/socketSpeech.ts';
import { OpenAiRecognition, OpenAiSpeech, type RealtimeHost } from './openai.ts';

export const AZURE_ADAPTER = 'azure';
export const AZURE_TRANSCRIPTION_MODEL = 'gpt-4o-transcribe';

/** The socket address on a person's own Azure resource, for one deployment. An https address is used as wss. */
export function azureAddress(model: string, key: { reveal(): string }, base: string): SocketAddress {
    const root = base.replace(/^http(s?):\/\//i, 'ws$1://').replace(/\/+$/, '');
    return { url: `${root}/openai/v1/realtime?model=${encodeURIComponent(model)}`, headers: { 'api-key': key.reveal() } };
}

export const AZURE_HOST: RealtimeHost = { adapter: AZURE_ADAPTER, endpoint: '', connect: azureAddress, transcriptionModel: AZURE_TRANSCRIPTION_MODEL };

export class AzureRecognition extends OpenAiRecognition {
    constructor() {
        super(AZURE_HOST);
    }
}

export class AzureSpeech extends OpenAiSpeech {
    constructor() {
        super(AZURE_HOST);
    }
}
