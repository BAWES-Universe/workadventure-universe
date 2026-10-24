<script lang="ts">
    import { afterUpdate, createEventDispatcher, onDestroy, onMount } from "svelte";
    import { writable } from "svelte/store";
    import LL from "../../../../i18n/i18n-svelte";
    import { renderWordDocument, type RenderedWord } from "../../../FileViewer/wordDocument";
    import { pageInView } from "../../../FileViewer/wordPages";
    import { listenForPinch } from "../../../FileViewer/pinchGesture";
    import type { ViewerController, ViewerPages } from "../../../FileViewer/viewerController";
    import FileViewerOpening from "./FileViewerOpening.svelte";

    export let bytes: ArrayBuffer;
    export let name: string;
    /** A narrow panel (a phone): the page pill hints at pinching. */
    export let compact: boolean;
    export let controller: ViewerController | undefined = undefined;

    const dispatch = createEventDispatcher<{ loaded: { pageCount: number }; failed: void }>();

    const MIN_ZOOM = 0.5;
    const MAX_ZOOM = 5;

    let area: HTMLDivElement;
    let frame: HTMLIFrameElement | undefined;
    let areaWidth = 0;
    let rendered: RenderedWord | undefined;
    /** The page's whole size at 100% (width of a sheet with its desk margins, height of all of them). */
    let contentWidth = 0;
    let contentHeight = 0;
    let sheetTops: number[] = [];
    /** 100% is the page fitted to the panel's width; the plus and minus buttons and a pinch change this. */
    let userZoom = 1;
    let pinchHint = true;
    const pages = writable<ViewerPages>({ page: 1, count: 0 });
    const zoomPercent = writable(100);
    let frameDocument: Document | undefined;

    $: fitScale = contentWidth > 0 && areaWidth > 0 ? Math.min(1, areaWidth / contentWidth) : 1;
    $: scale = fitScale * userZoom;
    $: zoomPercent.set(Math.round(userZoom * 100));
    $: if ($pages.page > 1) pinchHint = false;

    /** How far down the document the reader was when the zoom or the panel's width changed, to keep them at the same place. */
    let scrollAnchor: number | undefined;
    let lastAreaWidth = 0;
    /** Where the reader was while the panel was shown: a hidden panel (display none) forgets its scroll position. */
    let lastPlace: number | undefined;

    // The panel was resized, or the phone turned: the page is fitted to the new width, so it is as tall as it is now.
    // The panel was shown again after being hidden: the reader is put back where they left it.
    $: if (areaWidth !== lastAreaWidth) {
        const height = area?.scrollHeight ?? 0;
        if (scrollAnchor === undefined) {
            if (lastAreaWidth > 0 && height > 0) scrollAnchor = area.scrollTop / height;
            else if (lastAreaWidth === 0 && areaWidth > 0) scrollAnchor = lastPlace;
        }
        lastAreaWidth = areaWidth;
    }

    function setZoom(next: number): void {
        const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
        if (zoom === userZoom) return;
        if (area && area.scrollHeight > 0) scrollAnchor = area.scrollTop / area.scrollHeight;
        userZoom = zoom;
    }

    // Once the document has its new size, the reader is back where they were, and the page number follows.
    afterUpdate(() => {
        if (scrollAnchor === undefined || !area) return;
        area.scrollTop = scrollAnchor * area.scrollHeight;
        scrollAnchor = undefined;
        updatePage();
    });

    function updatePage(): void {
        if (area && area.scrollHeight > 0 && area.clientWidth > 0) lastPlace = area.scrollTop / area.scrollHeight;
        if (sheetTops.length === 0 || !area) return;
        const page = pageInView({
            scrollTop: area.scrollTop,
            clientHeight: area.clientHeight,
            scrollHeight: area.scrollHeight,
            scale,
            sheetTops,
        });
        if (page !== $pages.page) pages.update((value) => ({ ...value, page }));
    }

    // --- Pinch (two fingers) and Ctrl + wheel zoom, from the panel and from over the document ---
    function onPinch(factor: number): void {
        setZoom(userZoom * factor);
        pinchHint = false;
    }

    function onWheel(event: WheelEvent): void {
        if (!event.ctrlKey) return;
        event.preventDefault();
        setZoom(userZoom * Math.exp(-event.deltaY * 0.01));
    }

    // A link in the document opens in a new tab, from here: the sealed page itself can run nothing.
    function onLinkClick(event: MouseEvent): void {
        const link = (event.target as Element | null)?.closest?.("a");
        if (!link) return;
        event.preventDefault();
        const href = link.getAttribute("href");
        if (href && /^(https?:|mailto:|tel:)/i.test(href)) window.open(href, "_blank", "noopener,noreferrer");
    }

    const stopListening = new Map<Document | HTMLElement, Array<() => void>>();

    function listen(target: Document | HTMLElement): void {
        target.addEventListener("wheel", onWheel as EventListener, { passive: false });
        target.addEventListener("click", onLinkClick as EventListener);
        stopListening.set(target, [
            listenForPinch(target, onPinch),
            () => target.removeEventListener("wheel", onWheel as EventListener),
            () => target.removeEventListener("click", onLinkClick as EventListener),
        ]);
    }

    function unlisten(target: Document | HTMLElement): void {
        stopListening.get(target)?.forEach((stop) => stop());
        stopListening.delete(target);
    }

    /** The panel was hidden while the pages loaded, so nothing could be measured yet. */
    let needsMeasure = false;

    function measure(loadedDocument: Document): void {
        const width = Math.ceil(loadedDocument.documentElement.scrollWidth);
        // A hidden panel has no layout: every size reads 0. Measure again when it is shown.
        if (width === 0) {
            needsMeasure = true;
            return;
        }
        needsMeasure = false;
        // The sealed page is as wide as a sheet and its desk margins, and as tall as all the sheets together.
        contentWidth = width;
        contentHeight = Math.ceil(loadedDocument.documentElement.scrollHeight);
        sheetTops = Array.from(loadedDocument.querySelectorAll<HTMLElement>("section.docx")).map(
            (sheet) => sheet.getBoundingClientRect().top
        );
    }

    $: if (needsMeasure && areaWidth > 0 && frameDocument) measure(frameDocument);

    function onFrameLoad(): void {
        const loadedDocument = frame?.contentDocument;
        if (!loadedDocument || !rendered) return;
        frameDocument = loadedDocument;
        measure(loadedDocument);
        listen(loadedDocument);
        pages.set({ page: 1, count: rendered.pageCount });
        dispatch("loaded", { pageCount: rendered.pageCount });
    }

    onMount(() => {
        controller = {
            pages: { subscribe: pages.subscribe },
            zoomPercent: { subscribe: zoomPercent.subscribe },
            zoomIn: () => setZoom(userZoom * 1.25),
            zoomOut: () => setZoom(userZoom / 1.25),
        };
        listen(area);
        renderWordDocument(bytes)
            .then((result) => {
                rendered = result;
                // The frame is as wide as a sheet before it loads, so its width can be measured right after.
                contentWidth = Math.ceil(result.pageWidth + 32);
            })
            .catch((error) => {
                console.warn("Could not read a Word file to preview it", error);
                dispatch("failed");
            });
    });

    onDestroy(() => {
        unlisten(area);
        if (frameDocument) unlisten(frameDocument);
    });
</script>

<div class="word-body">
    <div
        class="doc-area"
        bind:this={area}
        bind:clientWidth={areaWidth}
        on:scroll={updatePage}
        data-testid="fileViewerWord"
    >
        {#if rendered}
            <div class="sizer" style:width="{contentWidth * scale}px" style:height="{contentHeight * scale}px">
                <!--
                    A sealed page: it can run no script (no "allow-scripts"), and its own rules let it fetch nothing.
                    "allow-same-origin" only lets this panel measure it, zoom it and open its links.
                -->
                <iframe
                    bind:this={frame}
                    title={name}
                    sandbox="allow-same-origin"
                    srcdoc={rendered.srcdoc}
                    scrolling="no"
                    style:width="{contentWidth}px"
                    style:height="{contentHeight || 1000}px"
                    style:transform="scale({scale})"
                    on:load={onFrameLoad}
                />
            </div>
        {:else}
            <FileViewerOpening />
        {/if}
    </div>
    {#if $pages.count > 0}
        <div class="page-pill" aria-live="polite">
            {$LL.chat.fileViewer.pageOfShort({ page: $pages.page, count: $pages.count })}{#if compact && pinchHint}
                &nbsp;· {$LL.chat.fileViewer.pinchHint()}{/if}
        </div>
    {/if}
</div>

<style>
    .word-body {
        position: relative;
        flex: 1;
        min-height: 0;
        background: #3a3950;
    }

    .doc-area {
        position: absolute;
        inset: 0;
        overflow: auto;
        background: #3a3950;
        -webkit-overflow-scrolling: touch;
        /* One finger scrolls and two pinch: the panel decides pinch itself. */
        touch-action: pan-x pan-y;
    }

    .sizer {
        position: relative;
        /* Centred while narrower than the panel. */
        margin: 0 auto;
    }

    iframe {
        position: absolute;
        top: 0;
        left: 0;
        border: 0;
        background: #3a3950;
        transform-origin: 0 0;
    }

    .page-pill {
        position: absolute;
        left: 50%;
        bottom: calc(16px + env(safe-area-inset-bottom, 0px));
        transform: translateX(-50%);
        background: rgba(20, 19, 31, 0.9);
        color: #fff;
        font-size: 12px;
        padding: 6px 12px;
        border-radius: 999px;
        white-space: nowrap;
        pointer-events: none;
    }
</style>
