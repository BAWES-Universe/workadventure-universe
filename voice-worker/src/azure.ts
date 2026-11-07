// Azure OpenAI's realtime models (game #1910): the same Realtime API as OpenAI's (openai.ts), on the person's own Azure resource.
// A bot on one names `azure` for both hearing and speaking, with the deployment name as its model; its own Mind still writes
// every answer. What differs from OpenAI, from Azure's realtime docs (Nov 2026):
//
// - The address is the person's own resource (the key's endpoint, from Orbit): wss://<resource>/openai/v1/realtime?model=<deployment>.
//   There is no address to fall back on: a key without one can't be reached.
// - The address must be on Azure's own names (*.openai.azure.com, *.cognitiveservices.azure.com, *.services.ai.azure.com),
//   over https, on the usual port, with no user name or password in it: the same rule Orbit checks when the key is added. It
//   is checked again here before every connection, so the key never goes to an address that isn't Azure's.
// - The key goes in the `api-key` header, and nowhere else.
// - Words are written down by gpt-4o-transcribe, a transcription model Azure runs inside the session.
import { failure } from './kit/errors.ts';
import type { SocketAddress } from './kit/socketSpeech.ts';
import { OpenAiRecognition, OpenAiSpeech, type RealtimeHost } from './openai.ts';

export const AZURE_ADAPTER = 'azure';
export const AZURE_TRANSCRIPTION_MODEL = 'gpt-4o-transcribe';

/** The names an Azure OpenAI resource answers on: the same list Orbit accepts for the key's address. */
export const AZURE_HOSTS = ['.openai.azure.com', '.cognitiveservices.azure.com', '.services.ai.azure.com'];

/** Whether an address is a resource on Azure's own names, over https, on the usual port, with no user name or password. */
export function isAzureResource(base: string): boolean {
    let url: URL;
    try {
        url = new URL(base);
    } catch {
        return false;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'wss:') return false;
    if (url.username || url.password || (url.port !== '' && url.port !== '443')) return false;
    const host = url.hostname.toLowerCase();
    return AZURE_HOSTS.some((suffix) => host.endsWith(suffix) && host.length > suffix.length);
}

/**
 * The socket address on a person's own Azure resource, for one deployment. An https address is used as wss. An address that
 * isn't an Azure resource is refused before anything is sent (`anyHost` is only for tests against a server on loopback).
 */
export function azureAddress(model: string, key: { reveal(): string }, base: string, anyHost = false): SocketAddress {
    if (!anyHost && !isAzureResource(base)) throw failure(AZURE_ADAPTER, 'address is not an Azure resource');
    const root = base.replace(/^http(s?):\/\//i, 'ws$1://').replace(/\/+$/, '');
    return { url: `${root}/openai/v1/realtime?model=${encodeURIComponent(model)}`, headers: { 'api-key': key.reveal() } };
}

const azureHost = (anyHost: boolean): RealtimeHost => ({
    adapter: AZURE_ADAPTER,
    endpoint: '',
    connect: (model, key, base) => azureAddress(model, key, base, anyHost),
    transcriptionModel: AZURE_TRANSCRIPTION_MODEL,
});

/** Tests only: reach a stand-in server on loopback. The worker never sets it. */
export interface AzureOptions {
    anyHost?: boolean;
}

export class AzureRecognition extends OpenAiRecognition {
    constructor(options: AzureOptions = {}) {
        super(azureHost(options.anyHost === true));
    }
}

export class AzureSpeech extends OpenAiSpeech {
    constructor(options: AzureOptions = {}) {
        super(azureHost(options.anyHost === true));
    }
}
