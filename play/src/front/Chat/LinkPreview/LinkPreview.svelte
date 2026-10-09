<script lang="ts">
    import { onDestroy } from "svelte";
    import { v4 as uuid } from "uuid";
    import LL from "../../../i18n/i18n-svelte";
    import { coWebsites } from "../../Stores/CoWebsiteStore";
    import { SimpleCoWebsite } from "../../WebRtc/CoWebsite/SimpleCoWebsite";
    import type { LinkKind } from "./LinkKind";
    import { APP_ICONS, youtubeSvg } from "./appIcons";
    import { classifyChatLink, previewedLinkOf } from "./ChatLinkKind";
    import type { WebPreview, YoutubePreview } from "./LinkPreviewFetcher";
    import { fetchWebPreview, fetchYoutubePreview, playingChatVideoStore } from "./LinkPreviewFetcher";
    import { IconExternalLink, IconPlayerPlayFilled } from "@wa-icons";

    /** The message text: its first link gets a preview, unless it was sent without one (<link>). */
    export let body: string;
    /** On the sender's own (blue) bubble the card is darker. */
    export let mine = false;
    /** The card is the whole message: the link it shows was the message's only text. */
    export let alone = false;

    // Lets a video in a frame autoplay, go fullscreen and keep playing in picture-in-picture.
    const VIDEO_POLICY = "autoplay; encrypted-media; fullscreen; picture-in-picture;";

    const previewId = uuid();

    let link: LinkKind | undefined;
    let web: WebPreview | undefined;
    let video: YoutubePreview = {};
    let imageFailed = false;
    let loadedFor: string | undefined;

    $: firstLink = previewedLinkOf(body ?? "");
    $: load(firstLink);

    function load(url: string | undefined) {
        if (url === loadedFor) return;
        loadedFor = url;
        link = undefined;
        web = undefined;
        video = {};
        imageFailed = false;
        if (!url) return;

        const kind = classifyChatLink(url);
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
    <div
        class="link-preview"
        class:link-preview-mine={mine}
        class:link-preview-alone={alone}
        data-testid="youtubeLinkPreview"
    >
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
                class="u-cta-secondary link-preview-button"
                on:click={() =>
                    link?.kind === "youtube" && openHere(youtubeEmbedUrl(link.videoId, link.start), VIDEO_POLICY)}
                data-testid="linkPreviewOpenHere"
            >
                {$LL.chat.linkPreview.openHere()}
            </button>
            <a
                class="u-cta-secondary link-preview-button"
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={$LL.chat.linkPreview.openOn({ site: "YouTube" })}
            >
                YouTube
                <IconExternalLink font-size={13} />
            </a>
        </div>
    </div>
{:else if link?.kind === "app"}
    <div
        class="link-preview"
        class:link-preview-mine={mine}
        class:link-preview-alone={alone}
        data-testid="appLinkPreview"
    >
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
                <!-- Without the page's own title, the app's name above says it once. -->
                {#if web?.title}
                    <div class="link-preview-site">{link.name}</div>
                {/if}
            </div>
        </div>
        <div class="link-preview-actions">
            <button
                class="u-cta link-preview-button"
                on:click={() => link?.kind === "app" && openHere(link.embedUrl)}
                data-testid="linkPreviewOpenHere"
            >
                {$LL.chat.linkPreview.openHere()}
            </button>
            <a class="u-cta-secondary link-preview-button" href={link.url} target="_blank" rel="noopener noreferrer">
                {$LL.chat.linkPreview.newTab()}
                <IconExternalLink font-size={13} />
            </a>
        </div>
    </div>
{:else if link?.kind === "image" && !imageFailed}
    <a
        class="link-preview block"
        class:link-preview-mine={mine}
        class:link-preview-alone={alone}
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
        class:link-preview-alone={alone}
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
    .link-preview-alone {
        margin-top: 8px;
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
    /* The chat's pill buttons (u-cta for the one main action, u-cta-secondary for the rest), as on the ring and
       friend request cards. */
    .link-preview-button {
        display: inline-flex;
        flex: none;
        align-items: center;
        justify-content: center;
        gap: 4px;
        height: 32px;
        margin: 0;
        padding: 0 12px;
        border-radius: 9999px;
        font-size: 12px;
        font-weight: 700;
        line-height: 1;
        white-space: nowrap;
        color: white;
        text-decoration: none;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        &:hover {
            text-decoration: none;
        }
    }
    /* On a touch screen each button is a full 44px tap target. */
    @media (pointer: coarse) {
        .link-preview-button {
            height: 44px;
            padding: 0 16px;
            font-size: 13px;
        }
    }
</style>
