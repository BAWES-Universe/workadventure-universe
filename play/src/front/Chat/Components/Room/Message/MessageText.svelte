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

    function configured(marked: Marked): Marked {
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

    // Lazy loads hljs and markedHighlight, for a message that contains ```.
    async function getHighlightingMarked(): Promise<Marked> {
        const hljsPromise = import("highlight.js");
        const markedHighlightPromise = import("marked-highlight");
        const [hljsModule, markedHighlightModule] = await Promise.all([hljsPromise, markedHighlightPromise]);

        return configured(
            new Marked(
                markedHighlightModule.markedHighlight({
                    langPrefix: "hljs language-",
                    highlight(code, lang) {
                        const language = hljsModule.default.getLanguage(lang) ? lang : "plaintext";
                        return hljsModule.default.highlight(code, { language }).value;
                    },
                })
            )
        );
    }

    let html = "";
    let bubble: HTMLDivElement | undefined;
    let mounted = false;
    // The latest body asked for: a slower code render of an earlier body must not replace it.
    let latestRender = 0;

    function bodyUpdated() {
        if (mounted) dispatch("updateMessageBody");
    }

    // A message without code is written out at once, so it has its full height the first time it is drawn: older
    // messages added above the reader land at their size in one go, and nothing grows after (see RoomTimeline).
    // Code waits for its highlighter.
    function render(body: string) {
        const renderId = ++latestRender;
        const healed = remend(body);
        if (!healed.includes("```")) {
            try {
                html = linkifyBareDomains(configured(new Marked()).parse(healed) as string);
            } catch (error) {
                console.error("Failed to parse markdown content", error);
                html = body;
            }
            bodyUpdated();
            return;
        }
        getHighlightingMarked()
            .then((marked) => marked.parse(healed))
            .then((result) => {
                if (renderId === latestRender) html = linkifyBareDomains(result);
            })
            .catch((error) => {
                console.error("Failed to parse markdown content", error);
                if (renderId === latestRender) html = body;
            })
            .finally(() => {
                // A render that was replaced by a newer one has nothing new to tell the timeline.
                if (renderId === latestRender) bodyUpdated();
            });
    }

    const unsubscriber: Unsubscriber = content.subscribe((value) => render(value.body));

    onMount(() => {
        mounted = true;
        // Links inside the message's HTML: one listener on the bubble (Enter on a focused link is a click too).
        bubble?.addEventListener("click", openLinkHere);
        if (html !== "") dispatch("updateMessageBody");
    });

    onDestroy(() => {
        bubble?.removeEventListener("click", openLinkHere);
        unsubscriber();
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
        /* This style element is global: every rule stays inside the bubble, so it never reaches code elsewhere.
           :where() keeps the weight of a bare pre/code, so the highlighter's colours still win on a ``` block. */
        :where(.message-bubble) pre {
            margin: 0;
        }
        /* A ``` block: its own full-width box. */
        :where(.message-bubble pre) code {
            display: block;
            width: 100%;
            background-color: rgba(255, 255, 255, 0.1);
            border-radius: 8px;
            overflow-x: auto;
            padding: 0.2em 0.5em;
        }
        /* A ` word: a small chip inside the sentence, wrapping with it on a narrow screen. */
        :where(.message-bubble :not(pre)) > code {
            background-color: rgba(255, 255, 255, 0.12);
            border-radius: 6px;
            padding: 0.1em 0.35em;
            font-size: 0.9em;
            overflow-wrap: anywhere;
            box-decoration-break: clone;
            -webkit-box-decoration-break: clone;
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
