/**
 * Klipy's GIF API, called from the player's browser (Klipy's terms want the calls to come from the user's app).
 * The key goes in the URL path. Results are family-safe: Klipy's docs name the filter "content_filter" in some
 * places and "rating" in others, so both are sent (an unknown one is ignored).
 *
 * Klipy answers { result, data: { data: [item…], current_page, per_page, has_next } }. An item has
 * file: { hd | md | sm | xs: { gif | webp | mp4 …: { url, width, height } } }. The reading below is forgiving: an
 * answer that doesn't look like this gives an empty list instead of a broken picker.
 */

const API_BASE = "https://api.klipy.com/api/v1";
export const KLIPY_RATING = "pg";
export const KLIPY_CONTENT_FILTER = "medium";
export const GIFS_PER_PAGE = 24;

export interface GifItem {
    id: string;
    title: string;
    /** The small animated picture shown in the picker. */
    previewUrl: string;
    previewWidth: number;
    previewHeight: number;
    /** The GIF that is sent: its link is the message. */
    url: string;
}

export interface GifPage {
    items: GifItem[];
    hasNext: boolean;
}

export interface GifCategory {
    name: string;
    /** What a tap on the tile searches for. */
    query: string;
    previewUrl?: string;
}

export class KlipyError extends Error {
    constructor(message: string, public readonly status?: number) {
        super(message);
        this.name = "KlipyError";
    }
}

// Klipy wants a customer id on its requests. It is random, made once per page load: it names nobody.
let anonymousCustomerId: string | undefined;
function customerId(): string {
    anonymousCustomerId ??= typeof crypto.randomUUID === "function" ? crypto.randomUUID() : String(Math.random());
    return anonymousCustomerId;
}

type Fetch = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

interface MediaFile {
    url: string;
    width: number;
    height: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asMediaFile(value: unknown): MediaFile | undefined {
    if (!isRecord(value) || typeof value.url !== "string" || !value.url.startsWith("https://")) return undefined;
    const width = Number(value.width);
    const height = Number(value.height);
    return {
        url: value.url,
        width: Number.isFinite(width) && width > 0 ? width : 1,
        height: Number.isFinite(height) && height > 0 ? height : 1,
    };
}

/** The first of the wanted sizes and formats the item has: file.<size>.<format>, or file.<format> alone. */
function pickFile(item: Record<string, unknown>, sizes: string[], formats: string[]): MediaFile | undefined {
    const files = item.file ?? item.files;
    if (!isRecord(files)) return undefined;
    for (const size of sizes) {
        const bySize = files[size];
        if (!isRecord(bySize)) continue;
        for (const format of formats) {
            const found = asMediaFile(bySize[format]);
            if (found) return found;
        }
    }
    for (const format of formats) {
        const found = asMediaFile(files[format]);
        if (found) return found;
    }
    return undefined;
}

export function parseGifItem(raw: unknown): GifItem | undefined {
    if (!isRecord(raw)) return undefined;
    // Sent: a GIF, so every chat shows it as a picture (the chat tells an image link by its ending).
    const sent = pickFile(raw, ["md", "hd", "sm", "xs"], ["gif"]) ?? pickFile(raw, ["md", "hd", "sm", "xs"], ["webp"]);
    const preview = pickFile(raw, ["sm", "md", "xs", "hd"], ["webp", "gif"]) ?? sent;
    if (!sent || !preview) return undefined;
    const id = [raw.id, raw.slug].find((value) => typeof value === "string" || typeof value === "number");
    return {
        id: id !== undefined ? String(id) : sent.url,
        title: typeof raw.title === "string" ? raw.title : "",
        previewUrl: preview.url,
        previewWidth: preview.width,
        previewHeight: preview.height,
        url: sent.url,
    };
}

function pageOf(body: unknown): { rows: unknown[]; hasNext: boolean } {
    if (!isRecord(body)) return { rows: [], hasNext: false };
    const data = body.data;
    if (Array.isArray(data)) return { rows: data, hasNext: false };
    if (isRecord(data)) {
        const rows = Array.isArray(data.data) ? data.data : Array.isArray(data.results) ? data.results : [];
        return { rows, hasNext: data.has_next === true };
    }
    return { rows: [], hasNext: false };
}

export function parseGifPage(body: unknown): GifPage {
    const { rows, hasNext } = pageOf(body);
    const items: GifItem[] = [];
    for (const row of rows) {
        const item = parseGifItem(row);
        if (item) items.push(item);
    }
    return { items, hasNext };
}

export function parseGifCategories(body: unknown): GifCategory[] {
    let rows: unknown[] = [];
    if (isRecord(body)) {
        const data = body.data;
        if (Array.isArray(data)) rows = data;
        else if (isRecord(data)) {
            rows = [data.categories, data.data, data.results].find((candidate) => Array.isArray(candidate)) ?? [];
        }
    }
    const categories: GifCategory[] = [];
    for (const row of rows) {
        if (typeof row === "string") {
            categories.push({ name: row, query: row });
            continue;
        }
        if (!isRecord(row)) continue;
        const name = [row.category, row.name, row.title, row.query].find(
            (value): value is string => typeof value === "string" && value.trim() !== ""
        );
        if (name === undefined) continue;
        const query = [row.query, row.search_term, row.category, row.name].find(
            (value): value is string => typeof value === "string" && value.trim() !== ""
        );
        const preview = [row.preview_url, row.preview, row.image, row.gif].find(
            (value): value is string => typeof value === "string" && value.startsWith("https://")
        );
        categories.push({ name, query: query ?? name, previewUrl: preview });
    }
    return categories;
}

const SAFE_SEARCH = { rating: KLIPY_RATING, content_filter: KLIPY_CONTENT_FILTER };

export interface KlipyClient {
    search(query: string, page: number, signal?: AbortSignal): Promise<GifPage>;
    trending(page: number, signal?: AbortSignal): Promise<GifPage>;
    categories(signal?: AbortSignal): Promise<GifCategory[]>;
}

export function createKlipyClient(apiKey: string, fetchFn: Fetch = (url, init) => fetch(url, init)): KlipyClient {
    const base = `${API_BASE}/${encodeURIComponent(apiKey)}/gifs`;

    async function get(path: string, params: Record<string, string | number>, signal?: AbortSignal): Promise<unknown> {
        const query = new URLSearchParams(
            Object.entries({ ...params, customer_id: customerId() }).map(([key, value]) => [key, String(value)])
        );
        let response: Response;
        try {
            response = await fetchFn(`${base}/${path}?${query.toString()}`, { signal });
        } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") throw error;
            throw new KlipyError("Klipy could not be reached");
        }
        if (!response.ok) throw new KlipyError(`Klipy answered ${response.status}`, response.status);
        try {
            return await response.json();
        } catch {
            throw new KlipyError("Klipy sent an answer that is not JSON", response.status);
        }
    }

    return {
        async search(query, page, signal) {
            return parseGifPage(
                await get("search", { q: query, page, per_page: GIFS_PER_PAGE, ...SAFE_SEARCH }, signal)
            );
        },
        async trending(page, signal) {
            return parseGifPage(await get("trending", { page, per_page: GIFS_PER_PAGE, ...SAFE_SEARCH }, signal));
        },
        async categories(signal) {
            return parseGifCategories(await get("categories", {}, signal));
        },
    };
}
