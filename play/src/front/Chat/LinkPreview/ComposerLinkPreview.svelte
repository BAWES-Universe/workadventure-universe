<script lang="ts">
    import { onDestroy } from "svelte";
    import LL from "../../../i18n/i18n-svelte";
    import { extractChatLinks } from "./ChatLinks";
    import { classifyChatLink } from "./ChatLinkKind";
    import type { LinkKind } from "./LinkKind";
    import { APP_ICONS, youtubeSvg } from "./appIcons";
    import type { WebPreview, YoutubePreview } from "./LinkPreviewFetcher";
    import { fetchWebPreview, fetchYoutubePreview } from "./LinkPreviewFetcher";
    import { IconPlayerPlayFilled, IconWorld, IconX } from "@wa-icons";

    /**
     * The preview above the message box while typing (frame 3 of the approved mock): the card the message's first
     * link will get. × sends the link without a preview.
     */

    /** The message box's content, as HTML: the only tags are <br> line breaks. */
    export let message: string;
    /** The links whose preview was closed here: they are sent as <link>, which shows no card. */
    export let closedLinks: string[] = [];

    // Typing a link changes it on every key: it is looked up once the typing pauses.
    const SETTLE_MS = 400;

    let url: string | undefined;
    let link: LinkKind | undefined;
    let web: WebPreview | undefined;
    let video: YoutubePreview = {};
    let thumbnailFailed = false;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;

    function textOf(html: string): string {
        const withLines = html.replace(/<br\s*\/?>/gi, "\n");
        return new DOMParser().parseFromString(withLines, "text/html").body.textContent ?? "";
    }

    $: candidate = extractChatLinks(textOf(message ?? ""), 10).find((found) => !closedLinks.includes(found));
    $: settle(candidate);

    function settle(next: string | undefined) {
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = undefined;
        if (next === url) return;
        show(undefined);
        if (next) settleTimer = setTimeout(() => show(next), SETTLE_MS);
    }

    function show(next: string | undefined) {
        url = next;
        web = undefined;
        video = {};
        thumbnailFailed = false;
        link = next ? classifyChatLink(next) : undefined;
        if (!next || !link) return;
        if (link.kind === "youtube") {
            fetchYoutubePreview(link.videoId)
                .then((result) => {
                    if (url === next) video = result;
                })
                .catch((error) => console.error(error));
        } else if (link.kind === "app" || link.kind === "web") {
            fetchWebPreview(link.url)
                .then((result) => {
                    if (url === next) web = result;
                })
                .catch((error) => console.error(error));
        }
    }

    function siteOf(address: string): string {
        try {
            return new URL(address).hostname.replace(/^www\./, "");
        } catch {
            return address;
        }
    }

    function fileOf(address: string): string {
        try {
            return decodeURIComponent(new URL(address).pathname.split("/").pop() ?? "") || siteOf(address);
        } catch {
            return address;
        }
    }

    function close() {
        if (url) closedLinks = [...closedLinks, url];
    }

    onDestroy(() => {
        if (settleTimer) clearTimeout(settleTimer);
    });

    // A web page shows a preview only when it gives one, like its card in the chat.
    $: visible =
        link !== undefined &&
        (link.kind === "youtube" || link.kind === "app" || link.kind === "image" || !!(web?.title || web?.description));
</script>

{#if link && visible}
    <div class="composer-link" data-testid="composerLinkPreview">
        {#if link.kind === "youtube"}
            <span class="thumb">
                {#if !thumbnailFailed}
                    <img
                        src={`https://i.ytimg.com/vi/${link.videoId}/mqdefault.jpg`}
                        alt=""
                        draggable="false"
                        on:error={() => (thumbnailFailed = true)}
                    />
                {/if}
                <span class="play"><IconPlayerPlayFilled font-size={12} /></span>
            </span>
        {:else if link.kind === "app"}
            <span class="thumb icon">
                {#if link.icon ?? APP_ICONS[link.app]}
                    <img src={link.icon ?? APP_ICONS[link.app]} alt="" draggable="false" />
                {:else}
                    <IconWorld font-size={18} />
                {/if}
            </span>
        {:else if link.kind === "image" && !thumbnailFailed}
            <span class="thumb">
                <img
                    src={link.url}
                    alt=""
                    draggable="false"
                    referrerpolicy="no-referrer"
                    on:error={() => (thumbnailFailed = true)}
                />
            </span>
        {:else if link.kind === "web" && web?.image && !thumbnailFailed}
            <span class="thumb">
                <img
                    src={web.image}
                    alt=""
                    draggable="false"
                    referrerpolicy="no-referrer"
                    on:error={() => (thumbnailFailed = true)}
                />
            </span>
        {:else}
            <span class="thumb icon"><IconWorld font-size={18} /></span>
        {/if}
        <div class="text">
            {#if link.kind === "youtube"}
                <span class="site"><img src={youtubeSvg} alt="" draggable="false" />YouTube</span>
                <span class="title">{video.title ?? link.url}</span>
            {:else if link.kind === "app"}
                <span class="site">{link.name}</span>
                <span class="title">{web?.title ?? siteOf(link.url)}</span>
            {:else if link.kind === "image"}
                <span class="site">{siteOf(link.url)}</span>
                <span class="title">{fileOf(link.url)}</span>
            {:else}
                <span class="site">{web?.siteName || siteOf(link.url)}</span>
                <span class="title">{web?.title || web?.description}</span>
            {/if}
        </div>
        <button
            class="close"
            on:click={close}
            aria-label={$LL.chat.linkPreview.sendWithoutPreview()}
            title={$LL.chat.linkPreview.sendWithoutPreview()}
            data-testid="composerLinkPreviewClose"
        >
            <IconX font-size={18} />
        </button>
    </div>
{/if}

<style lang="scss">
    /* The same box as the reply preview above the message field. */
    .composer-link {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        padding: 8px 6px 8px 8px;
        border-radius: 14px;
        background: rgb(20 18 30 / 0.97);
        border: 1px solid rgb(167 139 250 / 0.32);
        box-shadow: 0 8px 24px rgb(0 0 0 / 0.4);
        color: white;
    }

    .thumb {
        position: relative;
        flex: none;
        width: 64px;
        height: 36px;
        border-radius: 8px;
        overflow: hidden;
        background: rgb(255 255 255 / 0.08);
        display: grid;
        place-items: center;
        color: rgb(255 255 255 / 0.7);

        img {
            width: 100%;
            height: 100%;
            object-fit: cover;
        }
    }

    .thumb.icon {
        width: 36px;

        img {
            width: 26px;
            height: 26px;
            object-fit: contain;
        }
    }

    .play {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        color: white;
        background: rgb(0 0 0 / 0.25);
    }

    .text {
        display: flex;
        flex-direction: column;
        min-width: 0;
        flex: 1;
        line-height: 1.3;
    }

    .site {
        display: flex;
        align-items: center;
        gap: 5px;
        font-size: 11px;
        color: rgb(255 255 255 / 0.6);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;

        img {
            width: 14px;
            height: 14px;
            flex: none;
        }
    }

    .title {
        font-size: 13px;
        font-weight: 700;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .close {
        width: 32px;
        height: 32px;
        flex: none;
        margin: 0;
        padding: 0;
        display: grid;
        place-items: center;
        border-radius: 9999px;
        color: rgb(255 255 255 / 0.7);
        background: transparent;
        -webkit-tap-highlight-color: transparent;
    }

    .close:hover,
    .close:focus-visible {
        background: rgb(255 255 255 / 0.1);
        color: #fff;
        outline: none;
    }

    /* A bigger target for fingers than the 32px it shows. */
    @media (pointer: coarse) {
        .close {
            width: 44px;
            height: 44px;
            margin: -6px -4px -6px 0;
        }
    }
</style>
