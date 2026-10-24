<script lang="ts">
    import type { Readable, Unsubscriber } from "svelte/store";
    import { Marked } from "marked";
    import { onDestroy, onMount, createEventDispatcher } from "svelte";
    import remend from "remend";
    import type { ChatMessageContent } from "../../../Connection/ChatConnection";
    import { linkifyBareDomains } from "../../../LinkPreview/ChatLinks";
    import { classifyChatLink } from "../../../LinkPreview/ChatLinkKind";
    import { isPlainClick, opensHere } from "../../../LinkPreview/EmbeddableLinks";
    import { openChatLinkHere } from "../../../LinkPreview/openChatLinkHere";
    import { sanitizeHTML } from "./WA-HTML-Sanitizer";
    export let content: Readable<ChatMessageContent>;
    export let hasDepth: false;

    const dispatch = createEventDispatcher<{
        updateMessageBody: void;
    }>();

    async function getMarked(body: string): Promise<Marked> {
        let marked: Marked;

        // Let's lazy load hljs and markedHighlight if the message contains ```.
        if (body.includes("```")) {
            const hljsPromise = import("highlight.js");
            const markedHighlightPromise = import("marked-highlight");
            const [hljsModule, markedHighlightModule] = await Promise.all([hljsPromise, markedHighlightPromise]);

            marked = new Marked(
                markedHighlightModule.markedHighlight({
                    langPrefix: "hljs language-",
                    highlight(code, lang) {
                        const language = hljsModule.default.getLanguage(lang) ? lang : "plaintext";
                        return hljsModule.default.highlight(code, { language }).value;
                    },
                })
            );
        } else {
            marked = new Marked();
        }

        // Custom renderer for links
        const renderer = new marked.Renderer();
        renderer.link = (href: string, title: string, text: string) => {
            const titleAttr = title ? `title="${title}"` : "";
            return `<a href="${href}" target="_blank" rel="noopener noreferrer" ${titleAttr} style="color: white;">${text}</a>`;
        };

        // Apply the custom renderer and enable line breaks
        marked.use({
            renderer,
            breaks: true,
        });

        return marked;
    }

    let html = "";
    let bubble: HTMLDivElement | undefined;

    let unsubscriber: Unsubscriber | undefined;
    onMount(() => {
        // Links inside the message's HTML: one listener on the bubble (Enter on a focused link is a click too).
        bubble?.addEventListener("click", openLinkHere);
        unsubscriber = content.subscribe((value) => {
            const healed = remend(value.body);
            let promiseHtml = getMarked(healed).then((marked) => marked.parse(healed));
            promiseHtml
                .then((result) => {
                    html = linkifyBareDomains(result);
                })
                .catch((error) => {
                    console.error("Failed to parse markdown content", error);
                    html = $content.body;
                })
                .finally(() => {
                    dispatch("updateMessageBody");
                });
        });
    });

    onDestroy(() => {
        bubble?.removeEventListener("click", openLinkHere);
        if (unsubscriber) {
            unsubscriber();
        }
    });

    /**
     * A plain click on a web page link whose page the game may show opens it in the window, as its card's Open here
     * does. Video and app links (their Open here shows an embed, not the link), other links, and other clicks keep
     * opening a new tab.
     */
    function openLinkHere(event: MouseEvent) {
        const anchor = event.target instanceof Element ? event.target.closest("a") : null;
        if (!anchor || !isPlainClick(event) || !opensHere(anchor.href)) return;
        if (classifyChatLink(anchor.href).kind !== "web") return;
        event.preventDefault();
        openChatLinkHere(anchor.href);
    }

    /* eslint-disable svelte/no-at-html-tags */
</script>

<div
    class="message-bubble m-0 {hasDepth ? 'text-xs leading-4' : 'text-sm'} text-white py-1 px-2"
    style="padding-top: 7px;"
    lang=""
    bind:this={bubble}
>
    <!-- One box around the text, so its first and last block can drop the browser's outer margins. -->
    <div class="message-body">{@html sanitizeHTML(html)}</div>
    <style>
        /* A message of several paragraphs (or one starting with a list) kept 14px above its first line. */
        .message-body > :first-child {
            margin-top: 0;
        }
        .message-body > :last-child {
            margin-bottom: 0;
        }
        .response .message-bubble p:last-of-type {
            text-overflow: ellipsis;
            overflow: hidden;
            display: -webkit-box;
            -webkit-box-orient: vertical;
            -webkit-line-clamp: 1;
        }
        .message-bubble p:last-of-type {
            margin: 0;
        }
        .message-bubble a {
            text-decoration: underline;
            opacity: 0.75;
        }
        .message-bubble table {
            display: block;
            overflow-x: auto;
            white-space: nowrap;
            max-width: 100%;
        }
        pre {
            margin: 0;
        }
        code {
            display: block;
            width: 100%;
            background-color: rgba(255, 255, 255, 0.1);
            padding: 0.25em 0.5em;
            border-radius: 8px;
            overflow-x: auto;
            padding: 0.2em 0.5em;
        }
        ::-webkit-scrollbar {
            width: 2px;
            height: 6px;
        }

        /* Track */
        /* Track */
        ::-webkit-scrollbar-track {
        }

        /* Handle */
        ::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.5);
            border-radius: 3px;
        }
    </style>
</div>

<style>
</style>
