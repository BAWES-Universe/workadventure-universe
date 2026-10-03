import { writable } from "svelte/store";
import { ABSOLUTE_PUSHER_URL } from "../../Enum/ComputedConst";
import { localUserStore } from "../../Connection/LocalUserStore";

export interface WebPreview {
    url: string;
    siteName: string;
    title?: string;
    description?: string;
    image?: string;
}

export interface YoutubePreview {
    title?: string;
    channel?: string;
}

// A link shown in several messages (or again after scrolling) is looked up once per session.
const webPreviews = new Map<string, Promise<WebPreview | undefined>>();
const youtubePreviews = new Map<string, Promise<YoutubePreview>>();

/**
 * The title, description and image a web page gives for previews. The pusher reads the page: the browser can't read
 * other sites. Undefined when the page can't be previewed.
 */
export function fetchWebPreview(url: string): Promise<WebPreview | undefined> {
    let preview = webPreviews.get(url);
    if (!preview) {
        preview = fetch(`${ABSOLUTE_PUSHER_URL}link-preview?url=${encodeURIComponent(url)}`, {
            headers: { Authorization: localUserStore.getAuthToken() ?? "" },
        })
            .then(async (response) => (response.ok ? ((await response.json()) as WebPreview) : undefined))
            .catch((error) => {
                console.warn("Could not load a link preview", error);
                // Offline for a moment: try again the next time the link is shown.
                webPreviews.delete(url);
                return undefined;
            });
        webPreviews.set(url, preview);
    }
    return preview;
}

/** A video's title and channel, from YouTube itself (oEmbed allows the browser to ask). */
export function fetchYoutubePreview(videoId: string): Promise<YoutubePreview> {
    let preview = youtubePreviews.get(videoId);
    if (!preview) {
        const oembed = new URL("https://www.youtube.com/oembed");
        oembed.searchParams.set("url", `https://www.youtube.com/watch?v=${videoId}`);
        oembed.searchParams.set("format", "json");
        preview = fetch(oembed.toString())
            .then(async (response) => {
                if (!response.ok) return {};
                const data = (await response.json()) as { title?: unknown; author_name?: unknown };
                return {
                    title: typeof data.title === "string" ? data.title : undefined,
                    channel: typeof data.author_name === "string" ? data.author_name : undefined,
                };
            })
            .catch(() => {
                youtubePreviews.delete(videoId);
                return {};
            });
        youtubePreviews.set(videoId, preview);
    }
    return preview;
}

/** The chat video playing in place, if any: starting another one stops it. */
export const playingChatVideoStore = writable<string | undefined>(undefined);
