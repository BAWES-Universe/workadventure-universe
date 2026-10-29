import { createKlipyClient } from "./KlipyClient";
import type { GifCategory, KlipyClient } from "./KlipyClient";

/** How long the first screen (the tiles) is kept: after this, the next opening asks Klipy again. */
export const GIF_HOME_TTL_MS = 5 * 60 * 1000;

/**
 * What the picker keeps from one opening to the next, for a few minutes: it is built again each time it opens, and
 * should not show its placeholders or load its tile pictures again for what it already knew. Searches and the GIF
 * lists behind a tile are not kept.
 */
export interface GifSession {
    /** The category tiles Klipy sent. */
    categories?: GifCategory[];
    /** The first trending GIF's picture: the Trending tile's background. */
    trendingPreview?: string;
    /** When the first screen was first filled in: the five minutes count from there. */
    loadedAt?: number;
    /** The tile pictures, held so the browser keeps them for the next opening instead of loading them again. */
    pictures?: Map<string, HTMLImageElement>;
}

const sessions = new WeakMap<KlipyClient, GifSession>();

export function gifSessionOf(client: KlipyClient, now = Date.now()): GifSession {
    let session = sessions.get(client);
    if (!session) {
        session = {};
        sessions.set(client, session);
    }
    if (session.loadedAt !== undefined && now - session.loadedAt >= GIF_HOME_TTL_MS) {
        session.categories = undefined;
        session.trendingPreview = undefined;
        session.loadedAt = undefined;
        session.pictures = undefined;
    }
    return session;
}

/** Starts the five minutes, once, when the first screen has something to keep. */
export function markGifSessionLoaded(session: GifSession, now = Date.now()): void {
    session.loadedAt ??= now;
}

/** Loads a tile picture and holds it for the session, so the next opening gets it without a new request. */
export function holdGifPicture(session: GifSession, url: string | undefined): void {
    if (!url || typeof Image === "undefined") return;
    session.pictures ??= new Map();
    if (session.pictures.has(url)) return;
    const picture = new Image();
    // As on the tiles themselves.
    picture.referrerPolicy = "no-referrer";
    picture.decoding = "async";
    picture.src = url;
    session.pictures.set(url, picture);
}

/** Whether a tile picture was already loaded this session: its tile can show it at once, without waiting. */
export function isGifPictureHeld(session: GifSession | undefined, url: string | undefined): boolean {
    return url !== undefined && session?.pictures?.has(url) === true;
}

let sharedClient: { apiKey: string; client: KlipyClient } | undefined;

/** One Klipy client for the page, so what is kept for the session follows it from one opening to the next. */
export function sharedKlipyClient(apiKey: string): KlipyClient {
    if (sharedClient?.apiKey !== apiKey) sharedClient = { apiKey, client: createKlipyClient(apiKey) };
    return sharedClient.client;
}
