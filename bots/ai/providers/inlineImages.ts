/**
 * Pictures put inside the request itself (#1570). Ollama's OpenAI-compatible API takes a picture only as
 * `data:image/...;base64`, never as a link, so a person's own-computer key is sent each picture that way. Hosted
 * providers keep getting links: they fetch them themselves.
 */

import { FileParser } from '../../services/FileParser';

/** The most one picture may be: the chat's limit for a file a bot fetches (BotClient, FileParser). */
export const MAX_INLINE_IMAGE_BYTES = 25 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;

/** The picture type its first bytes say, for a server that labels a picture as plain bytes. */
function sniffedType(bytes: Uint8Array): string | null {
    const starts = (...signature: number[]) => signature.every((byte, i) => bytes[i] === byte);
    if (starts(0x89, 0x50, 0x4e, 0x47)) return 'image/png';
    if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
    if (starts(0x47, 0x49, 0x46, 0x38)) return 'image/gif';
    if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
    return null;
}

/** The body, or null when it is bigger than one picture may be. */
async function readCapped(response: Response): Promise<Uint8Array | null> {
    const reader = response.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_INLINE_IMAGE_BYTES) {
            await reader.cancel().catch(() => {});
            return null;
        }
        chunks.push(value);
    }
    return Buffer.concat(chunks);
}

/**
 * One picture as a `data:` address. Anything that goes wrong (not a picture, too big, unreachable) leaves the link as
 * it was, which is what the model got before. Each hop is checked like any address a bot fetches (FileParser).
 */
export async function inlineImage(url: string): Promise<string> {
    if (url.startsWith('data:')) return url;
    try {
        let current = url;
        for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
            await FileParser.validateUrl(current);
            const response = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
            if (response.status >= 300 && response.status < 400) {
                const location = response.headers.get('location');
                if (!location) return url;
                current = new URL(location, current).href;
                continue;
            }
            const labelled = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
            const declared = Number(response.headers.get('content-length'));
            if (!response.ok || (labelled && !labelled.startsWith('image/') && labelled !== 'application/octet-stream') || declared > MAX_INLINE_IMAGE_BYTES) {
                await response.body?.cancel().catch(() => {});
                return url;
            }
            const bytes = await readCapped(response);
            const type = bytes && (labelled.startsWith('image/') ? labelled : sniffedType(bytes));
            if (!bytes || !type) return url;
            return `data:${type};base64,${Buffer.from(bytes).toString('base64')}`;
        }
    } catch (error) {
        if (process.env.ENABLE_BOT_DEBUG === 'true') {
            console.warn('[inlineImages] Picture left as a link:', error instanceof Error ? error.message : error);
        }
    }
    return url;
}

export function inlineImages(urls: string[]): Promise<string[]> {
    return Promise.all(urls.map((url) => inlineImage(url)));
}
