<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import LL, { locale } from "../../../../../i18n/i18n-svelte";
    import type { ChatMessage } from "../../../Connection/ChatConnection";
    import { fetchWebPreview, type WebPreview } from "../../../LinkPreview/LinkPreviewFetcher";
    import { classifyChatLink } from "../../../LinkPreview/ChatLinkKind";
    import { isPlainClick, opensHere } from "../../../LinkPreview/EmbeddableLinks";
    import { openChatLinkHere } from "../../../LinkPreview/openChatLinkHere";
    import { sentLabel } from "./SharedItems";
    import { sharedSender } from "./sharedSender";
    import { IconLink } from "@wa-icons";

    /**
     * A link the chat shared: its page's picture and title when it has a preview, the site, who sent it and when. The
     * preview is only asked for once the row comes into view, not while its tab waits beside the open one.
     */
    export let url: string;
    export let message: ChatMessage;

    let preview: WebPreview | undefined;
    let row: HTMLElement;
    let observer: IntersectionObserver | undefined;
    let asked = false;

    function load() {
        if (asked) return;
        asked = true;
        fetchWebPreview(url)
            .then((result) => (preview = result))
            .catch((error) => console.error(error));
    }

    onMount(() => {
        if (typeof IntersectionObserver === "undefined") {
            load();
            return;
        }
        observer = new IntersectionObserver(
            (entries) => {
                if (!entries.some((entry) => entry.isIntersecting)) return;
                load();
                observer?.disconnect();
            },
            // Ahead while scrolling down, but not sideways into the next tab.
            { rootMargin: "200px 0px" }
        );
        observer.observe(row);
    });

    onDestroy(() => observer?.disconnect());

    function siteOf(link: string): string {
        try {
            return new URL(link).hostname.replace(/^www\./, "");
        } catch {
            return link;
        }
    }

    // A web page the game may show opens beside the map, as its card in the chat does; anything else opens a new tab.
    function open(event: MouseEvent) {
        if (!isPlainClick(event) || classifyChatLink(url).kind !== "web" || !opensHere(url)) return;
        event.preventDefault();
        openChatLinkHere(url);
    }

    $: site = siteOf(url);
    $: title = preview?.title || site;
    $: by = $LL.chat.details.sentBy({
        name: sharedSender(message, $LL.chat.details.you()),
        when: sentLabel(message.date, $locale),
    });
</script>

<a
    href={url}
    target="_blank"
    rel="noopener noreferrer"
    class="shared-row flex min-h-[44px] items-center gap-3 rounded-xl p-2 text-inherit no-underline"
    on:click={open}
    bind:this={row}
    data-testid="sharedLink"
>
    <span class="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-lg bg-white/10 text-white/70">
        {#if preview?.image}
            <img class="h-full w-full object-cover" src={preview.image} alt="" draggable="false" />
        {:else}
            <IconLink font-size="20" />
        {/if}
    </span>
    <span class="flex min-w-0 flex-1 flex-col">
        <span class="truncate text-sm font-bold text-white">{title}</span>
        <span class="truncate text-xs text-white/60">{preview?.siteName || site}</span>
        <span class="truncate text-[11px] text-white/45">{by}</span>
    </span>
</a>

<style>
    .shared-row:hover {
        background: rgba(255, 255, 255, 0.06);
    }
    .shared-row:focus-visible {
        outline: 2px solid rgba(196, 181, 253, 0.9);
        outline-offset: -2px;
    }
</style>
