import type { ApplicationDefinitionInterface } from "@workadventure/messages";
import {
    ApplicationService,
    CardsService,
    EraserService,
    ExcalidrawService,
    KlaxoonService,
    TldrawService,
} from "@workadventure/shared-utils";

/** The apps a chat link can open beside the map, and whether the room allows each one. */
export interface LinkApps {
    youtube: boolean;
    googleDocs: boolean;
    googleSheets: boolean;
    googleSlides: boolean;
    googleDrive: boolean;
    klaxoon: boolean;
    klaxoonClientId?: string;
    eraser: boolean;
    excalidraw: boolean;
    excalidrawDomains: string[];
    cards: boolean;
    tldraw: boolean;
    custom: ApplicationDefinitionInterface[];
}

export type AppId =
    | "googleDocs"
    | "googleSheets"
    | "googleSlides"
    | "googleDrive"
    | "klaxoon"
    | "eraser"
    | "excalidraw"
    | "cards"
    | "tldraw"
    | "custom";

export type LinkKind =
    | { kind: "youtube"; url: string; videoId: string; start?: number }
    | { kind: "app"; url: string; app: AppId; name: string; embedUrl: string; icon?: string }
    | { kind: "image"; url: string }
    | { kind: "web"; url: string };

const YOUTUBE_HOSTS = ["youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com"];
const YOUTUBE_ID = /^[\w-]{11}$/;

/** The video of a YouTube watch, share, embed, shorts or live link. */
export function youtubeVideoOf(url: URL): { videoId: string; start?: number } | undefined {
    const host = url.hostname.replace(/^www\./, "");
    let videoId: string | undefined;
    if (host === "youtu.be") {
        videoId = url.pathname.slice(1).split("/")[0];
    } else if (YOUTUBE_HOSTS.includes(host)) {
        if (url.pathname === "/watch") {
            videoId = url.searchParams.get("v") ?? undefined;
        } else {
            videoId = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]+)/)?.[1];
        }
    }
    if (!videoId || !YOUTUBE_ID.test(videoId)) return undefined;
    const start = parseStart(url.searchParams.get("t") ?? url.searchParams.get("start"));
    return { videoId, start };
}

/** "90", "90s" or "1m30s" in seconds. */
function parseStart(value: string | null): number | undefined {
    if (!value) return undefined;
    const match = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
    if (!match) return undefined;
    const seconds = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
    return seconds > 0 ? seconds : undefined;
}

function googleApp(url: URL): AppId | undefined {
    const host = url.hostname;
    if (host === "docs.google.com") {
        if (url.pathname.startsWith("/document/")) return "googleDocs";
        if (url.pathname.startsWith("/spreadsheets/")) return "googleSheets";
        if (url.pathname.startsWith("/presentation/")) return "googleSlides";
    }
    if (host === "drive.google.com" && /^\/file\/d\/[\w-]+/.test(url.pathname)) return "googleDrive";
    return undefined;
}

function googleEmbedUrl(url: URL, app: AppId): string {
    const embed = new URL(url.toString());
    if (app === "googleDrive") {
        // Drive's player page for any file is /preview.
        embed.pathname = embed.pathname.replace(/\/(view|edit)?\/?$/, "/preview");
        if (!embed.pathname.endsWith("/preview")) embed.pathname += "/preview";
        return embed.toString();
    }
    embed.searchParams.set("embedded", "true");
    return embed.toString();
}

const GOOGLE_NAMES: Record<string, string> = {
    googleDocs: "Google Docs",
    googleSheets: "Google Sheets",
    googleSlides: "Google Slides",
    googleDrive: "Google Drive",
};

const IMAGE_PATH = /\.(png|jpe?g|gif|webp|avif)$/i;

/** What a link in a chat message is, and so how it previews. */
export function classifyLink(link: string, apps: LinkApps): LinkKind {
    let url: URL;
    try {
        url = new URL(link);
    } catch {
        return { kind: "web", url: link };
    }

    const video = apps.youtube ? youtubeVideoOf(url) : undefined;
    if (video) return { kind: "youtube", url: link, ...video };

    const google = googleApp(url);
    if (google && apps[google]) {
        return {
            kind: "app",
            url: link,
            app: google,
            name: GOOGLE_NAMES[google],
            embedUrl: googleEmbedUrl(url, google),
        };
    }
    if (apps.klaxoon && KlaxoonService.isKlaxoonLink(url)) {
        return {
            kind: "app",
            url: link,
            app: "klaxoon",
            name: "Klaxoon",
            embedUrl: KlaxoonService.getKlaxoonEmbedUrl(new URL(link), apps.klaxoonClientId),
        };
    }
    if (apps.eraser && EraserService.isEraserLink(url)) {
        return { kind: "app", url: link, app: "eraser", name: "Eraser", embedUrl: link };
    }
    if (
        apps.excalidraw &&
        ExcalidrawService.isExcalidrawLink(
            url,
            apps.excalidrawDomains.length > 0 ? apps.excalidrawDomains : ["excalidraw.com"]
        )
    ) {
        return { kind: "app", url: link, app: "excalidraw", name: "Excalidraw", embedUrl: link };
    }
    if (apps.cards && CardsService.isCardsLink(url)) {
        return { kind: "app", url: link, app: "cards", name: "Cards", embedUrl: CardsService.getCardsLink(url) };
    }
    if (apps.tldraw && TldrawService.isTldrawLink(url)) {
        return { kind: "app", url: link, app: "tldraw", name: "tldraw", embedUrl: link };
    }
    for (const custom of apps.custom) {
        if (!custom.regexUrl) continue;
        try {
            if (url.host !== new URL(custom.regexUrl).host) continue;
            const embedUrl = ApplicationService.validateLink(url, custom.regexUrl, "", custom.targetUrl);
            return { kind: "app", url: link, app: "custom", name: custom.name, embedUrl, icon: custom.image };
        } catch {
            continue;
        }
    }

    if (IMAGE_PATH.test(url.pathname)) return { kind: "image", url: link };
    return { kind: "web", url: link };
}
