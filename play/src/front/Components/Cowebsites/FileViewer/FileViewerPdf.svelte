<script lang="ts">
    import { createEventDispatcher, onDestroy, onMount } from "svelte";
    import { writable } from "svelte/store";
    import type { PDFDocumentProxy } from "pdfjs-dist";
    import LL from "../../../../i18n/i18n-svelte";
    import { loadPdfJs, pdfDocumentOptions, type PdfJs } from "../../../FileViewer/pdfjs";
    import { findCountOf } from "../../../FileViewer/pdfFind";
    import { presetToApplyAgain } from "../../../FileViewer/pdfScale";
    import { printPdfPages } from "../../../FileViewer/printPdfPages";
    import type { ViewerController, ViewerPages, ViewerView } from "../../../FileViewer/viewerController";

    /** The PDF's bytes. A copy is given to the reader, so these stay whole for Download and Open in new tab. */
    export let bytes: ArrayBuffer;
    /** A narrow panel (a phone): no page list, and the page pill hints at pinching. */
    export let compact: boolean;
    export let controller: ViewerController | undefined = undefined;
    /** Where the reader was left when it was put away: the zoom and how far it was scrolled. */
    export let view: ViewerView | undefined = undefined;

    const dispatch = createEventDispatcher<{ loaded: { pageCount: number }; failed: void }>();

    let container: HTMLDivElement;
    let viewerElement: HTMLDivElement;
    let thumbsElement: HTMLElement | undefined;

    const pages = writable<ViewerPages>({ page: 1, count: 0 });
    const zoomPercent = writable(100);
    const matches = writable<{ current: number; total: number } | undefined>(undefined);
    const thumbsShown = writable(true);
    /** The hint under the page number goes once the person has found their way around (scrolled or zoomed). */
    let pinchHint = true;
    let preparingToPrint = false;

    let pdfjs: PdfJs | undefined;
    let pdfDocument: PDFDocumentProxy | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let pdfViewer: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let eventBus: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let loadingTask: any;
    let resizeObserver: ResizeObserver | undefined;
    let destroyed = false;

    $: pageNumbers = Array.from({ length: $pages.count }, (_, index) => index + 1);
    $: if ($pages.page > 1) pinchHint = false;

    function clampScale(scale: number): number {
        return Math.min(5, Math.max(0.25, scale));
    }

    function applyPresetAgain(): void {
        if (!pdfViewer?.pdfDocument) return;
        // A preset such as "auto" or "page-width" follows the panel's width: apply it again at the new width, but not
        // while the panel is hidden and has none.
        const preset = presetToApplyAgain(pdfViewer.currentScaleValue, container.clientWidth);
        if (preset) pdfViewer.currentScaleValue = preset;
    }

    function buildController(): ViewerController {
        return {
            pages: { subscribe: pages.subscribe },
            zoomPercent: { subscribe: zoomPercent.subscribe },
            zoomIn: () => pdfViewer?.increaseScale({ steps: 1 }),
            zoomOut: () => pdfViewer?.decreaseScale({ steps: 1 }),
            fitWidth: () => {
                if (pdfViewer) pdfViewer.currentScaleValue = "page-width";
            },
            rotate: () => {
                if (pdfViewer) pdfViewer.pagesRotation = (pdfViewer.pagesRotation + 90) % 360;
            },
            print: printDocument,
            search: {
                find: (query) => dispatchFind(query, "", false),
                next: (backwards) => dispatchFind(lastQuery, "again", backwards),
                clear: () => {
                    lastQuery = "";
                    matches.set(undefined);
                    eventBus?.dispatch("findbarclose", { source: container });
                },
                matches: { subscribe: matches.subscribe },
            },
            pageList: pageListFor(compact),
        };
    }

    function pageListFor(isCompact: boolean): ViewerController["pageList"] {
        return isCompact
            ? undefined
            : { shown: { subscribe: thumbsShown.subscribe }, toggle: () => thumbsShown.update((shown) => !shown) };
    }

    // The page list button follows the panel when it gets narrow or wide again (a phone turned on its side).
    function followPanelWidth(isCompact: boolean): void {
        if (controller) controller = { ...controller, pageList: pageListFor(isCompact) };
    }
    $: followPanelWidth(compact);

    let lastQuery = "";

    async function printDocument(): Promise<void> {
        const document = pdfDocument;
        if (!document || preparingToPrint) return;
        preparingToPrint = true;
        try {
            await printPdfPages(document);
        } catch (error) {
            console.error("Could not print the PDF", error);
        } finally {
            // eslint-disable-next-line require-atomic-updates
            preparingToPrint = false;
        }
    }

    function dispatchFind(query: string, type: "" | "again", findPrevious: boolean): void {
        if (!eventBus) return;
        lastQuery = query;
        if (query === "") {
            matches.set(undefined);
            eventBus.dispatch("findbarclose", { source: container });
            return;
        }
        eventBus.dispatch("find", {
            source: container,
            type,
            query,
            caseSensitive: false,
            entireWord: false,
            highlightAll: true,
            findPrevious,
            matchDiacritics: false,
        });
    }

    // --- Pinch and Ctrl + wheel zoom: PDF.js' viewer part has the zoom, the page gives it the gesture ---
    let pinchDistance = 0;

    function touchDistance(event: TouchEvent): number {
        const [first, second] = [event.touches[0], event.touches[1]];
        return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
    }

    function onTouchStart(event: TouchEvent): void {
        pinchDistance = event.touches.length === 2 ? touchDistance(event) : 0;
    }

    function onTouchMove(event: TouchEvent): void {
        if (event.touches.length !== 2 || pinchDistance === 0 || !pdfViewer) return;
        event.preventDefault();
        const distance = touchDistance(event);
        const origin = [
            (event.touches[0].clientX + event.touches[1].clientX) / 2,
            (event.touches[0].clientY + event.touches[1].clientY) / 2,
        ];
        pdfViewer.updateScale({ scaleFactor: distance / pinchDistance, origin, drawingDelay: 200 });
        pinchDistance = distance;
        pinchHint = false;
    }

    function onTouchEnd(event: TouchEvent): void {
        if (event.touches.length < 2) pinchDistance = 0;
    }

    function onWheel(event: WheelEvent): void {
        // A trackpad pinch arrives as Ctrl + wheel: it zooms the file, not the whole game page.
        if (!event.ctrlKey || !pdfViewer) return;
        event.preventDefault();
        pdfViewer.updateScale({
            scaleFactor: Math.exp(-event.deltaY * 0.01),
            origin: [event.clientX, event.clientY],
            drawingDelay: 100,
        });
    }

    // --- The page list: small pictures of the pages, drawn when they come into view ---
    const THUMB_WIDTH = 46;
    const thumbQueue: Array<{ canvas: HTMLCanvasElement; page: number }> = [];
    const drawnThumbs = new WeakSet<HTMLCanvasElement>();
    let drawingThumbs = false;
    let thumbObserver: IntersectionObserver | undefined;
    const thumbPage = new WeakMap<Element, number>();

    async function drawThumbs(): Promise<void> {
        if (drawingThumbs) return;
        drawingThumbs = true;
        try {
            // One at a time: the reader's worker draws the visible pages first.
            /* eslint-disable no-await-in-loop */
            while (thumbQueue.length > 0 && !destroyed && pdfDocument) {
                const next = thumbQueue.shift();
                if (!next || drawnThumbs.has(next.canvas) || !next.canvas.isConnected) continue;
                const page = await pdfDocument.getPage(next.page);
                const base = page.getViewport({ scale: 1 });
                const ratio = window.devicePixelRatio || 1;
                const viewport = page.getViewport({ scale: (THUMB_WIDTH * ratio) / base.width });
                next.canvas.width = Math.floor(viewport.width);
                next.canvas.height = Math.floor(viewport.height);
                next.canvas.style.height = `${Math.round((THUMB_WIDTH * base.height) / base.width)}px`;
                await page.render({ canvas: next.canvas, viewport }).promise;
                drawnThumbs.add(next.canvas);
                page.cleanup();
            }
            /* eslint-enable no-await-in-loop */
        } catch (error) {
            console.warn("Could not draw a page of the page list", error);
        } finally {
            drawingThumbs = false;
        }
    }

    function thumbnail(canvas: HTMLCanvasElement, page: number) {
        thumbPage.set(canvas, page);
        thumbObserver?.observe(canvas);
        return {
            destroy() {
                thumbObserver?.unobserve(canvas);
            },
        };
    }

    function goToPage(page: number): void {
        if (pdfViewer) pdfViewer.currentPageNumber = page;
    }

    $: if ($pages.page && thumbsElement) {
        thumbsElement.querySelector<HTMLElement>(`[data-page="${$pages.page}"]`)?.scrollIntoView({ block: "nearest" });
    }

    onMount(() => {
        void start();
        return () => undefined;
    });

    /** The file has its size and its place: before that, what the reader would report is not where the reader was. */
    let placed = false;

    function onPagesInit(): void {
        pdfViewer.currentScaleValue = view?.zoom !== undefined ? String(view.zoom) : "auto";
        pages.set({ page: 1, count: pdfViewer.pagesCount });
        restoreScroll();
        // With a place to go back to, the file has its place once that is put back (see `onFirstPageRendered`).
        if (view?.scrollY === undefined) placed = true;
    }

    // Brought back after being put away: the file goes back to where it was left. PDF.js moves to the first page as it
    // starts, so the place is put back once that has happened, and again when the first page is drawn.
    function restoreScroll(): void {
        if (view?.scrollY === undefined) return;
        requestAnimationFrame(putBackPlace);
        eventBus?.on("pagerendered", onFirstPageRendered);
    }

    function putBackPlace(): void {
        if (!destroyed && container && view?.scrollY !== undefined) container.scrollTop = view.scrollY * container.scrollHeight;
    }

    function onFirstPageRendered(): void {
        eventBus?.off("pagerendered", onFirstPageRendered);
        putBackPlace();
        placed = true;
    }

    /** What the reader needs to look the same when it is brought back. */
    export function getView(): ViewerView | undefined {
        if (!placed) return undefined;
        // As a share of the file's height: the panel may have been turned or resized by the time it is back, and the
        // file then draws at another size.
        const height = container?.scrollHeight ?? 0;
        return {
            zoom: pdfViewer?.currentScaleValue ?? undefined,
            scrollY: height > 0 ? container.scrollTop / height : 0,
        };
    }

    function onPageChanging(event: { pageNumber: number }): void {
        pages.update((value) => ({ ...value, page: event.pageNumber }));
    }

    function onScaleChanging(event: { scale: number }): void {
        zoomPercent.set(Math.round(clampScale(event.scale) * 100));
    }

    function onMatchesCount(event: { state?: number; matchesCount: { current: number; total: number } }): void {
        const count = findCountOf(event);
        if (count) matches.set(count);
    }

    async function start(): Promise<void> {
        try {
            pdfjs = await loadPdfJs();
            if (destroyed) return;
            const { lib, viewer } = pdfjs;
            eventBus = new viewer.EventBus();
            const linkService = new viewer.PDFLinkService({
                eventBus,
                // Links inside a file open in a new tab only, with no access back to the game.
                externalLinkTarget: viewer.LinkTarget.BLANK,
                externalLinkRel: "noopener noreferrer nofollow",
            });
            const findController = new viewer.PDFFindController({ linkService, eventBus });
            pdfViewer = new viewer.PDFViewer({
                container,
                viewer: viewerElement,
                eventBus,
                linkService,
                findController,
                // No scripting manager is made: the file's scripts never run. Form fields can still be filled in.
                annotationMode: lib.AnnotationMode.ENABLE_FORMS,
                annotationEditorMode: lib.AnnotationEditorType.DISABLE,
                l10n: new viewer.GenericL10n("en"),
            });
            linkService.setViewer(pdfViewer);

            eventBus.on("pagesinit", onPagesInit);
            eventBus.on("pagechanging", onPageChanging);
            eventBus.on("scalechanging", onScaleChanging);
            eventBus.on("updatefindmatchescount", onMatchesCount);
            eventBus.on("updatefindcontrolstate", onMatchesCount);

            // A copy: the reader takes the bytes it is given, and Download and Open in new tab still need the file.
            loadingTask = lib.getDocument(pdfDocumentOptions(new Uint8Array(bytes.slice(0))));
            pdfDocument = await loadingTask.promise;
            if (destroyed || !pdfDocument) return;
            pdfViewer.setDocument(pdfDocument);
            linkService.setDocument(pdfDocument, null);
            thumbObserver = new IntersectionObserver(
                (entries) => {
                    for (const entry of entries) {
                        const page = thumbPage.get(entry.target);
                        if (entry.isIntersecting && page !== undefined) {
                            thumbQueue.push({ canvas: entry.target as HTMLCanvasElement, page });
                            thumbObserver?.unobserve(entry.target);
                        }
                    }
                    void drawThumbs();
                },
                { root: thumbsElement ?? null, rootMargin: "200px 0px" }
            );
            resizeObserver = new ResizeObserver(() => requestAnimationFrame(applyPresetAgain));
            resizeObserver.observe(container);
            controller = buildController();
            dispatch("loaded", { pageCount: pdfDocument.numPages });
        } catch (error) {
            if (destroyed) return;
            // A damaged or password-locked PDF, or one that is not a PDF at all.
            console.warn("Could not preview a PDF", error);
            dispatch("failed");
        }
    }

    onDestroy(() => {
        destroyed = true;
        eventBus?.off("pagesinit", onPagesInit);
        eventBus?.off("pagerendered", onFirstPageRendered);
        eventBus?.off("pagechanging", onPageChanging);
        eventBus?.off("scalechanging", onScaleChanging);
        eventBus?.off("updatefindmatchescount", onMatchesCount);
        eventBus?.off("updatefindcontrolstate", onMatchesCount);
        resizeObserver?.disconnect();
        thumbObserver?.disconnect();
        pdfViewer?.cleanup?.();
        loadingTask?.destroy?.();
    });
</script>

<div class="pdf-body">
    {#if $thumbsShown && !compact && $pages.count > 0}
        <aside class="thumbs" bind:this={thumbsElement} aria-label={$LL.chat.fileViewer.pageList()}>
            {#each pageNumbers as pageNumber (pageNumber)}
                <button
                    type="button"
                    class="thumb"
                    class:on={pageNumber === $pages.page}
                    data-page={pageNumber}
                    aria-label={$LL.chat.fileViewer.pageNumber({ page: pageNumber })}
                    aria-current={pageNumber === $pages.page ? "page" : undefined}
                    on:click={() => goToPage(pageNumber)}
                >
                    <canvas use:thumbnail={pageNumber} width="1" height="1" />
                </button>
            {/each}
        </aside>
    {/if}
    <div class="pdf-area">
        <div
            bind:this={container}
            class="viewer-container"
            dir="ltr"
            on:touchstart|passive={onTouchStart}
            on:touchmove={onTouchMove}
            on:touchend|passive={onTouchEnd}
            on:wheel={onWheel}
        >
            <div bind:this={viewerElement} class="pdfViewer" />
        </div>
        {#if $pages.count > 0}
            <div class="page-pill" aria-live="polite">
                {#if preparingToPrint}
                    {$LL.chat.fileViewer.preparingToPrint()}
                {:else if compact}
                    {$LL.chat.fileViewer.pageOfShort({ page: $pages.page, count: $pages.count })}{#if pinchHint}
                        &nbsp;· {$LL.chat.fileViewer.pinchHint()}{/if}
                {:else}
                    {$LL.chat.fileViewer.pageOf({ page: $pages.page, count: $pages.count })}
                {/if}
            </div>
        {/if}
    </div>
</div>

<style>
    .pdf-body {
        flex: 1;
        display: flex;
        min-height: 0;
    }

    .pdf-area {
        position: relative;
        flex: 1;
        min-width: 0;
        background: #3a3950;
    }

    .viewer-container {
        position: absolute;
        inset: 0;
        overflow: auto;
        -webkit-overflow-scrolling: touch;
        /* One finger scrolls and two pinch: the page decides pinch itself. */
        touch-action: pan-x pan-y;
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

    .thumbs {
        width: 74px;
        flex: none;
        background: #262539;
        padding: 10px 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
        overflow-y: auto;
    }

    .thumb {
        flex: none;
        width: 46px;
        padding: 0;
        margin: 0;
        border: 0;
        border-radius: 2px;
        background: #fff;
        opacity: 0.85;
        cursor: pointer;
        display: block;
        line-height: 0;
    }

    .thumb canvas {
        width: 46px;
        height: 60px;
        display: block;
        border-radius: 2px;
    }

    .thumb.on {
        outline: 2px solid #b9a6ff;
        outline-offset: 2px;
        opacity: 1;
    }

    /* The reader's pages sit on the panel's colour with the mock's soft shadow. */
    :global(.viewer-container .pdfViewer .page) {
        --page-border: none;
        --page-margin: 14px auto;
        border-radius: 3px;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
    }
</style>
