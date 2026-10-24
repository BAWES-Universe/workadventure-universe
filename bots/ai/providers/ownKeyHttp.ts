/**
 * How a provider reaches a person's own AI key (#374). Server providers are untouched: `ownKey` is only set on a
 * provider that is someone's own key, and only a key whose address the person typed goes through the address guard.
 */

import type { AIProviderConfig } from '../types';
import { ownComputerFetch } from '../ownComputerFetch';

/** `fetch` for this provider: the address guard for an address a person typed, the plain global `fetch` for everything else. */
export function fetchFor(config: AIProviderConfig): typeof fetch {
    if (config.ownKey?.addressTyped) return ownComputerFetch as typeof fetch;
    return ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => fetch(input, init)) as typeof fetch;
}

/**
 * The HTTP status an "... API error: 401 ..." message carries, so a rejected key can be told from a server that is down.
 * A key that has run out of credit is reported as 402 whatever status the provider used for it (OpenAI answers 429
 * `insufficient_quota`), so a quota that is spent isn't mistaken for a busy moment.
 */
export function statusFromError(error: unknown): number | undefined {
    const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
    const match = /API error: (\d{3})\b/.exec(message);
    if (!match) return undefined;
    const status = Number(match[1]);
    if (status === 429 && /insufficient_quota|exceeded your current quota/i.test(message)) return 402;
    return status;
}
