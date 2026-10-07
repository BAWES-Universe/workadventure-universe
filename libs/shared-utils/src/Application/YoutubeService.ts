import type { AxiosResponse } from "axios";
import axios from "axios";
import { YoutubeException } from "./Exception/YoutubeException";

// Create type data for Youtube embed
export type YoutubeEmbedData = {
    title: string;
    html: string;
};

const cacheManagement: Map<string, YoutubeEmbedData> = new Map();

const getUrlFromHtml = (html: string) => {
    const div = document.createElement("div");
    div.insertAdjacentHTML("beforeend", html);
    const iframe: HTMLIFrameElement = div.firstChild as HTMLIFrameElement;
    return iframe.src;
};

const generateUrlOembed = (url: URL) => {
    const urlToFetch = new URL("https://www.youtube.com/oembed");
    urlToFetch.searchParams.set("url", url.toString());
    urlToFetch.searchParams.set("format", "json");
    return urlToFetch.toString();
};

const YOUTUBE_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_PATH_ID_PREFIXES = ["shorts", "live", "embed", "v", "e"];

const isHostOrSubdomainOf = (hostname: string, domain: string): boolean => {
    return hostname === domain || hostname.endsWith("." + domain);
};

const isYoutubeHost = (url: URL): boolean => {
    const hostname = url.hostname.toLowerCase();
    return (
        hostname === "youtu.be" ||
        isHostOrSubdomainOf(hostname, "youtube.com") ||
        isHostOrSubdomainOf(hostname, "youtube-nocookie.com")
    );
};

// Returns the id of the video designed by a Youtube link (youtu.be/ID, /watch?v=ID, /shorts/ID, /live/ID, /embed/ID, /v/ID, /e/ID)
export const getYoutubeVideoId = (url: URL): string | undefined => {
    if (!isYoutubeHost(url)) return undefined;
    const hostname = url.hostname.toLowerCase();
    const segments = url.pathname.split("/").filter((segment) => segment !== "");
    let candidate: string | null | undefined;
    if (hostname === "youtu.be") {
        candidate = segments[0];
    } else if (segments[0] === "watch") {
        candidate = url.searchParams.get("v");
    } else if (segments[0] !== undefined && YOUTUBE_PATH_ID_PREFIXES.includes(segments[0])) {
        candidate = segments[1];
    }
    // "/embed/videoseries?list=..." is a playlist embed: "videoseries" is not a video id, even if it looks like one
    if (candidate === "videoseries") return undefined;
    return candidate != undefined && YOUTUBE_ID_REGEX.test(candidate) ? candidate : undefined;
};

// Returns the start time (in seconds) of a Youtube link ("t" or "start" parameter: 90, 90s, 1m30s, 1h2m3s)
export const getYoutubeStartSeconds = (url: URL): number | undefined => {
    const value = url.searchParams.get("t") ?? url.searchParams.get("start");
    if (value == undefined) return undefined;
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);
    const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i.exec(trimmed);
    if (!match || trimmed === "") return undefined;
    const [, hours, minutes, seconds] = match;
    return parseInt(hours ?? "0", 10) * 3600 + parseInt(minutes ?? "0", 10) * 60 + parseInt(seconds ?? "0", 10);
};

// Returns the "watch" (or "playlist") form of any Youtube link, the one the oEmbed endpoint understands
export const getCanonicalYoutubeUrl = (url: URL): URL => {
    const list = url.searchParams.get("list");
    const videoId = getYoutubeVideoId(url);
    if (videoId !== undefined) {
        const canonical = new URL("https://www.youtube.com/watch");
        canonical.searchParams.set("v", videoId);
        if (list) canonical.searchParams.set("list", list);
        return canonical;
    }
    if (isYoutubeHost(url) && url.pathname === "/playlist" && list) {
        const canonical = new URL("https://www.youtube.com/playlist");
        canonical.searchParams.set("list", list);
        return canonical;
    }
    return url;
};

const fetchYoutubeEmbedUrl = async (url: URL): Promise<string> => {
    const urlToFetch = generateUrlOembed(url);
    const cachedYoutubeEmbedData = cacheManagement.get(urlToFetch);
    if (cachedYoutubeEmbedData) {
        return getUrlFromHtml(cachedYoutubeEmbedData.html);
    }
    return await axios.get(urlToFetch).then((res: AxiosResponse<YoutubeEmbedData>) => {
        cacheManagement.set(urlToFetch, res.data);
        const html = res.data.html;
        if (html == undefined) throw new Error("No html found");
        return getUrlFromHtml(html);
    });
};

export const getYoutubeEmbedUrl = async (url: URL): Promise<string> => {
    if (isEmbeddableYoutubeLink(url)) return url.toString();
    const canonicalUrl = getCanonicalYoutubeUrl(url);
    const startSeconds = canonicalUrl === url ? undefined : getYoutubeStartSeconds(url);
    const embedUrl = await fetchYoutubeEmbedUrl(canonicalUrl);
    if (startSeconds === undefined) return embedUrl;
    const embed = new URL(embedUrl);
    embed.searchParams.set("start", startSeconds.toString());
    return embed.toString();
};

// Create function to check if the link is a Youtube link
export const isYoutubeLink = (url: URL): boolean => {
    return isYoutubeHost(url);
};

// Create function to check if the Youtube link in parameter is embeddable or not
export const isEmbeddableYoutubeLink = (url: URL): boolean => {
    return isYoutubeHost(url) && url.pathname.startsWith("/embed/");
};

// Get title from youtube link save in cache
export const getTitleFromYoutubeUrl = (url: URL): string | undefined => {
    return cacheManagement.get(generateUrlOembed(url))?.title;
};

export const validateYoutubeLink = (url: URL) => {
    if (!isYoutubeLink(url)) throw new YoutubeException();
};
