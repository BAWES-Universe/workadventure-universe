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
 * `insufficient_quota`), so a quota that is spent isn't mistaken for a busy moment, and a busy moment isn't taken for no credit.
 */
export function statusFromError(error: unknown): number | undefined {
    const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
    const match = /API error: (\d{3})\b/.exec(message);
    if (!match) return undefined;
    const status = Number(match[1]);
    // Only OpenAI's own code: Gemini says "You exceeded your current quota" for a per-minute rate limit too, which is a busy
    // moment, not a key out of credit
    if (status === 429 && /insufficient_quota/.test(message)) return 402;
    return status;
}

/** A login written into an address (`https://user:password@host`), up to the last `@` before the path. */
const URL_LOGIN = /([a-z][a-z0-9+.-]*:\/\/)[^/?#\s]*@/gi;

/** A key or token a provider's error text could carry: `Bearer ...`, `sk-...`, `AIza...`, or any long run of key-like characters. */
const TOKEN_LIKE = /\bBearer\s+\S+|\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}|\bAIza[0-9A-Za-z_-]{20,}|[A-Za-z0-9_+/=-]{32,}/g;

/**
 * What a failed provider call said, fit for a log line: one line, no login from an address, no key or token, at most
 * 200 characters.
 * Provider error answers say what went wrong ("maximum context length", "invalid api key"), never the conversation.
 */
export function providerErrorText(error: unknown): string {
    const message = error instanceof Error ? error.message : typeof error === 'string' ? error : String(error);
    const line = message
        .replace(URL_LOGIN, '$1[redacted]@')
        .replace(TOKEN_LIKE, '[redacted]')
        .replace(/\s+/g, ' ')
        .trim();
    return line.length > 200 ? `${line.slice(0, 199)}…` : line || 'unknown error';
}
