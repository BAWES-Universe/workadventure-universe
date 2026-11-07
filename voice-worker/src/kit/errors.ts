// What a company's refusal means, the same way for every company: a refused key (401, 403), no credit left (402), too
// many requests (429), anything else. Companies that say "out of credit" with another status are mapped by their spec.
import { ProviderError } from '../connectors.ts';

/** How a spec spots an answer that means "out of credit" whatever status it came with. */
export type CreditCheck = (status: number, body: string) => boolean;

/**
 * The status the worker reports for a company's answer: 402 when the spec recognises "out of credit" in it, otherwise the
 * company's own status. The body is read only for that check and never kept or logged: it could repeat the key.
 */
export function answerStatus(status: number, body: string, outOfCredit?: CreditCheck): number {
    if (outOfCredit && status !== 402) {
        try {
            if (outOfCredit(status, body)) return 402;
        } catch {
            // A check that throws counts as "no"
        }
    }
    return status;
}

/** A failure that names the company and what went wrong, never the key. */
export const failure = (adapter: string, what: string, status?: number): ProviderError => new ProviderError(`${adapter} ${what}`, status);

/** Reads at most `max` bytes of a body as text, for the credit check. Never throws. */
export async function readSome(body: ReadableStream<Uint8Array> | null, max = 4096): Promise<string> {
    if (!body) return '';
    const reader = body.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    try {
        while (size < max) {
            const { done, value } = await reader.read();
            if (done || !value) break;
            parts.push(value);
            size += value.length;
        }
    } catch {
        // A body that breaks mid-way is read as far as it went
    } finally {
        await reader.cancel().catch(() => undefined);
    }
    return Buffer.concat(parts).subarray(0, max).toString('utf8');
}
