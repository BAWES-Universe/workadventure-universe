<script lang="ts">
    import { onDestroy } from "svelte";
    import { v4 as uuid } from "uuid";
    import LL from "../../../i18n/i18n-svelte";
    import { connectionManager } from "../../Connection/ConnectionManager";
    import { coWebsites } from "../../Stores/CoWebsiteStore";
    import { SimpleCoWebsite } from "../../WebRtc/CoWebsite/SimpleCoWebsite";
    import youtubeSvg from "../../Components/images/applications/icon_youtube.svg";
    import googleDocsSvg from "../../Components/images/applications/icon_google_docs.svg";
    import googleSheetsSvg from "../../Components/images/applications/icon_google_sheets.svg";
    import googleSlidesSvg from "../../Components/images/applications/icon_google_slides.svg";
    import googleDriveSvg from "../../Components/images/applications/icon_google_drive.svg";
    import klaxoonSvg from "../../Components/images/applications/icon_klaxoon.svg";
    import eraserSvg from "../../Components/images/applications/icon_eraser.svg";
    import excalidrawSvg from "../../Components/images/applications/icon_excalidraw.svg";
    import cardsSvg from "../../Components/images/applications/icon_cards.svg";
    import tldrawJpeg from "../../Components/images/applications/icon_tldraw.jpeg";
    import { extractChatLinks } from "./ChatLinks";
    import type { AppId, LinkKind } from "./LinkKind";
    import { classifyLink } from "./LinkKind";
    import type { WebPreview, YoutubePreview } from "./LinkPreviewFetcher";
    import { fetchWebPreview, fetchYoutubePreview, playingChatVideoStore } from "./LinkPreviewFetcher";
    import { IconExternalLink, IconLayoutSidebarRight, IconPlayerPlayFilled } from "@wa-icons";

    /** The message text: its first link gets a preview. */
    export let body: string;
    /** On the sender's own (blue) bubble the card is darker. */
    export let mine = false;

    const APP_ICONS: Record<AppId, string | undefined> = {
        googleDocs: googleDocsSvg,
        googleSheets: googleSheetsSvg,
        googleSlides: googleSlidesSvg,
        googleDrive: googleDriveSvg,
        klaxoon: klaxoonSvg,
        eraser: eraserSvg,
        excalidraw: excalidrawSvg,
        cards: cardsSvg,
        tldraw: tldrawJpeg,
        custom: undefined,
    };

    // Lets a video in a frame autoplay, go fullscreen and keep playing in picture-in-picture.
    const VIDEO_POLICY = "autoplay; encrypted-media; fullscreen; picture-in-picture;";

    const previewId = uuid();

    let link: LinkKind | undefined;
    let web: WebPreview | undefined;
    let video: YoutubePreview = {};
    let imageFailed = false;
    let loadedFor: string | undefined;

    $: firstLink = extractChatLinks(body ?? "", 1)[0];
    $: load(firstLink);

    function load(url: string | undefined) {
        if (url === loadedFor) return;
        loadedFor = url;
        link = undefined;
        web = undefined;
        video = {};
        imageFailed = false;
        if (!url) return;

        const kind = classifyLink(url, {
            youtube: connectionManager.youtubeToolActivated,
            googleDocs: connectionManager.googleDocsToolActivated,
            googleSheets: connectionManager.googleSheetsToolActivated,
            googleSlides: connectionManager.googleSlidesToolActivated,
            googleDrive: connectionManager.googleDriveToolActivated,
            klaxoon: connectionManager.klaxoonToolActivated,
            klaxoonClientId: connectionManager.klaxoonToolClientId,
            eraser: connectionManager.eraserToolActivated,
            excalidraw: connectionManager.excalidrawToolActivated,
            excalidrawDomains: connectionManager.excalidrawToolDomains,
            cards: connectionManager.cardsToolActivated,
            tldraw: connectionManager.tldrawToolActivated,
            custom: connectionManager.applications,
        });
        link = kind;

        if (kind.kind === "youtube") {
            fetchYoutubePreview(kind.videoId)
                .then((result) => {
                    if (loadedFor === url) video = result;
                })
                .catch((error) => console.error(error));
        } else if (kind.kind === "app" || kind.kind === "web") {
            fetchWebPreview(kind.url)
                .then((result) => {
                    if (loadedFor === url) web = result;
                })
                .catch((error) => console.error(error));
        }
    }

    function siteOf(url: string): string {
        try {
            return new URL(url).hostname.replace(/^www\./, "");
        } catch {
            return url;
        }
    }

    function youtubeEmbedUrl(videoId: string, start: number | undefined): string {
        const embed = new URL(`https://www.youtube-nocookie.com/embed/${videoId}`);
        embed.searchParams.set("autoplay", "1");
        embed.searchParams.set("rel", "0");
        if (start) embed.searchParams.set("start", String(start));
        return embed.toString();
    }

    function play() {
        playingChatVideoStore.set(previewId);
    }

    function openHere(url: string, allowPolicy?: string) {
        if ($playingChatVideoStore === previewId) playingChatVideoStore.set(undefined);
        try {
            coWebsites.add(new SimpleCoWebsite(new URL(url), false, allowPolicy));
        } catch (error) {
            console.error("Could not open a chat link beside the map", error);
        }
    }

    $: playing = $playingChatVideoStore === previewId;

    onDestroy(() => {
        // The message scrolled away or closed: its video stops.
        if ($playingChatVideoStore === previewId) playingChatVideoStore.set(undefined);
    });
</script>

{#if link?.kind === "youtube"}
    <div class="link-preview" class:link-preview-mine={mine} data-testid="youtubeLinkPreview">
        <div class="relative w-full aspect-video bg-black">
            {#if playing}
                <iframe
                    class="absolute inset-0 w-full h-full border-0"
                    src={youtubeEmbedUrl(link.videoId, link.start)}
                    title={video.title ?? "YouTube"}
                    allow={VIDEO_POLICY}
                    allowfullscreen
                    data-testid="youtubeLinkPreviewPlayer"
                />
            {:else}
                <button
                    class="absolute inset-0 w-full h-full p-0 m-0 border-0 rounded-none bg-transparent cursor-pointer group"
                    on:click={play}
                    aria-label={$LL.chat.linkPreview.play({ title: video.title ?? "YouTube" })}
                    data-testid="youtubeLinkPreviewPlay"
                >
                    <img
                        class="w-full h-full object-cover"
                        src={`https://i.ytimg.com/vi/${link.videoId}/hqdefault.jpg`}
                        alt=""
                        loading="lazy"
                        draggable="false"
                    />
                    <span
                        class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-14 h-10 rounded-xl bg-[#FF0000] flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform"
                    >
                        <IconPlayerPlayFilled font-size={20} class="text-white" />
                    </span>
                </button>
            {/if}
        </div>
        <div class="link-preview-meta">
            <div class="link-preview-site">
                <img src={youtubeSvg} alt="" class="w-3.5 h-3.5" draggable="false" />
                <span class="truncate">YouTube{video.channel ? ` · ${video.channel}` : ""}</span>
            </div>
            {#if video.title}
                <div class="link-preview-title">{video.title}</div>
            {/if}
        </div>
        <div class="link-preview-actions">
            <button
                class="link-preview-button"
                on:click={() =>
                    link?.kind === "youtube" && openHere(youtubeEmbedUrl(link.videoId, link.start), VIDEO_POLICY)}
                data-testid="linkPreviewOpenHere"
            >
                <IconLayoutSidebarRight font-size={14} />
                {$LL.chat.linkPreview.openHere()}
            </button>
            <a class="link-preview-button" href={link.url} target="_blank" rel="noopener noreferrer">
                {$LL.chat.linkPreview.openOn({ site: "YouTube" })}
                <IconExternalLink font-size={14} />
            </a>
        </div>
    </div>
{:else if link?.kind === "app"}
    <div class="link-preview" class:link-preview-mine={mine} data-testid="appLinkPreview">
        <div class="flex items-center gap-2.5 px-2.5 pt-2.5">
            {#if link.icon ?? APP_ICONS[link.app]}
                <img
                    src={link.icon ?? APP_ICONS[link.app]}
                    alt=""
                    class="w-7 h-7 rounded flex-none"
                    draggable="false"
                />
            {/if}
            <div class="min-w-0">
                <div class="link-preview-title !mt-0 truncate">{web?.title ?? link.name}</div>
                <div class="link-preview-site">{link.name}</div>
            </div>
        </div>
        <div class="link-preview-actions">
            <button
                class="link-preview-button link-preview-cta"
                on:click={() => link?.kind === "app" && openHere(link.embedUrl)}
                data-testid="linkPreviewOpenHere"
            >
                <IconLayoutSidebarRight font-size={14} />
                {$LL.chat.linkPreview.openHere()}
            </button>
            <a class="link-preview-button" href={link.url} target="_blank" rel="noopener noreferrer">
                {$LL.chat.linkPreview.newTab()}
                <IconExternalLink font-size={14} />
            </a>
        </div>
    </div>
{:else if link?.kind === "image" && !imageFailed}
    <a
        class="link-preview block"
        class:link-preview-mine={mine}
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="imageLinkPreview"
    >
        <img
            class="block w-full max-h-60 object-cover"
            src={link.url}
            alt=""
            loading="lazy"
            draggable="false"
            referrerpolicy="no-referrer"
            on:error={() => (imageFailed = true)}
        />
    </a>
{:else if link?.kind === "web" && web && (web.title || web.description)}
    <a
        class="link-preview block !no-underline !opacity-100"
        class:link-preview-mine={mine}
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="webLinkPreview"
    >
        {#if web.image && !imageFailed}
            <img
                class="block w-full aspect-[1.91/1] object-cover bg-white/5"
                src={web.image}
                alt=""
                loading="lazy"
                draggable="false"
                referrerpolicy="no-referrer"
                on:error={() => (imageFailed = true)}
            />
        {/if}
        <div class="link-preview-meta">
            <div class="link-preview-site"><span class="truncate">{web.siteName || siteOf(link.url)}</span></div>
            {#if web.title}
                <div class="link-preview-title">{web.title}</div>
            {/if}
            {#if web.description}
                <div class="link-preview-description">{web.description}</div>
            {/if}
        </div>
    </a>
{/if}

<style lang="scss">
    .link-preview {
        width: 300px;
        max-width: calc(100% - 16px);
        margin: 2px 8px 8px;
        border-radius: 10px;
        overflow: hidden;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
        color: white;
    }
    .link-preview-mine {
        background: rgba(0, 0, 0, 0.18);
        border-color: rgba(255, 255, 255, 0.18);
    }
    .link-preview-meta {
        padding: 8px 10px 9px;
    }
    .link-preview-site {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        line-height: 1.3;
        color: rgba(255, 255, 255, 0.6);
        min-width: 0;
    }
    .link-preview-title {
        margin-top: 3px;
        font-size: 13.5px;
        font-weight: 700;
        line-height: 1.3;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }
    .link-preview-description {
        margin-top: 3px;
        font-size: 12px;
        line-height: 1.35;
        color: rgba(255, 255, 255, 0.65);
        display: -webkit-box;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }
    .link-preview-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        padding: 8px 10px 10px;
    }
    .link-preview-button {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        margin: 0;
        padding: 6px 10px;
        font-size: 12px;
        font-weight: 600;
        line-height: 1;
        color: white;
        text-decoration: none;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.14);
        cursor: pointer;
        &:hover {
            background: rgba(255, 255, 255, 0.14);
        }
    }
    .link-preview-cta {
        border: 0;
        background: linear-gradient(90deg, #8629fc, #4156f6);
        box-shadow: 0 4px 14px rgba(134, 41, 252, 0.35);
        &:hover {
            background: linear-gradient(90deg, #8629fc, #4156f6);
            filter: brightness(1.1);
        }
    }
</style>
