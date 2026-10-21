<script lang="ts">
    import { afterUpdate, onDestroy, onMount } from "svelte";
    import { readable } from "svelte/store";
    import LL from "../../../i18n/i18n-svelte";
    import type { FileViewerCoWebsite } from "../../WebRtc/CoWebsite/FileViewerCoWebsite";
    import { coWebsites, fullScreenCowebsite } from "../../Stores/CoWebsiteStore";
    import { inputFormFocusStore } from "../../Stores/UserInputStore";
    import {
        NO_BROWSER_VIEWER_KINDS,
        TEXT_KINDS,
        badgeOfKind,
        bytesMatchKind,
        extensionOf,
        fileKindOf,
        type FileViewerKind,
    } from "../../FileViewer/fileKinds";
    import type { ViewerController } from "../../FileViewer/viewerController";
    import { MAX_WORD_BYTES } from "../../FileViewer/wordDocument";
    import FileViewerPdf from "./FileViewer/FileViewerPdf.svelte";
    import FileViewerImage from "./FileViewer/FileViewerImage.svelte";
    import FileViewerText from "./FileViewer/FileViewerText.svelte";
    import FileViewerWord from "./FileViewer/FileViewerWord.svelte";
    import {
        IconArrowLeft,
        IconDots,
        IconDownload,
        IconLayoutSidebar,
        IconMinus,
        IconPlus,
        IconSearch,
        IconX,
    } from "@wa-icons";

    export let actualCowebsite: FileViewerCoWebsite;
    export let visible: boolean;

    /** A file this big is not drawn in the page: it is offered as a download instead. */
    const MAX_VIEWER_BYTES = 100 * 1024 * 1024;
    /** Below this panel width (a phone) the toolbar is the phone one: Back, name, Search, Download. */
    const COMPACT_WIDTH = 480;

    const source = actualCowebsite.source;

    let root: HTMLDivElement;
    let panelWidth = 0;
    let phase: "opening" | "ready" | "failed" = "opening";
    let bytes: ArrayBuffer | undefined;
    let kind: FileViewerKind | undefined;
    let controller: ViewerController | undefined;
    let pageCount = 0;
    let rowCount: number | undefined;
    let menuOpen = false;
    let findOpen = false;
    let findQuery = "";
    let findTimer: ReturnType<typeof setTimeout> | undefined;
    /** The text the search was last started with, so Enter knows whether the box holds a new one. */
    let searchedQuery = "";
    let panelFocused = false;
    const abort = new AbortController();

    $: compact = panelWidth > 0 && panelWidth < COMPACT_WIDTH;
    const closable = actualCowebsite.isClosable();

    $: zoomPercent = controller?.zoomPercent ?? readable(100);
    $: pageListShown = controller?.pageList?.shown ?? readable(false);
    $: matches = controller?.search?.matches ?? readable(undefined);

    const badge = badgeFor(source.name);
    const isOldWord = fileKindOf(source.name) === "oldword";
    $: sender = source.sentByMe
        ? $LL.chat.fileViewer.fromYou()
        : source.senderName
        ? $LL.chat.fileViewer.from({ name: source.senderName })
        : "";
    $: pagesLabel =
        pageCount > 0
            ? $LL.chat.fileViewer.pages({ count: pageCount })
            : rowCount !== undefined
            ? $LL.chat.fileViewer.rows({ count: rowCount })
            : "";
    $: subtitle = compact && sender && pagesLabel ? `${sender} · ${pagesLabel}` : sender || pagesLabel;
    // A text file has nothing to hand to a browser viewer: Ctrl or Cmd click on its card opens it as plain text.
    $: canOpenInNewTab =
        source.openInNewTab !== undefined &&
        (phase === "ready" || source.openInNewTabFromLink === true) &&
        !(kind && NO_BROWSER_VIEWER_KINDS.has(kind));

    function badgeFor(name: string): { label: string; color: string } {
        const fileKind = fileKindOf(name);
        if (fileKind) return badgeOfKind(fileKind);
        const extension = extensionOf(name);
        return { label: (extension || "FILE").slice(0, 4).toUpperCase(), color: "#5b6b82" };
    }

    async function open(): Promise<void> {
        try {
            const loaded = await source.load(abort.signal);
            if (abort.signal.aborted) return;
            bytes = loaded;
            const fileKind = fileKindOf(source.name);
            if (
                !fileKind ||
                loaded.byteLength > MAX_VIEWER_BYTES ||
                (fileKind === "word" && loaded.byteLength > MAX_WORD_BYTES) ||
                !bytesMatchKind(fileKind, source.name, new Uint8Array(loaded))
            ) {
                phase = "failed";
                return;
            }
            kind = fileKind;
            phase = "ready";
        } catch (error) {
            if (abort.signal.aborted) return;
            console.warn("Could not read a file to preview it", error);
            phase = "failed";
        }
    }

    function onReaderFailed(): void {
        controller = undefined;
        phase = "failed";
    }

    function close(): void {
        coWebsites.remove(actualCowebsite);
    }

    $: canDownload = !source.downloadNeedsFile || bytes !== undefined;

    function download(): void {
        Promise.resolve(source.download(bytes)).catch((error) => console.error(error));
    }

    function openInNewTab(): void {
        menuOpen = false;
        source.openInNewTab?.(bytes);
    }

    function toggleFind(): void {
        findOpen = !findOpen;
        if (!findOpen) {
            controller?.search?.clear();
            findQuery = "";
            searchedQuery = "";
        }
    }

    function startSearch(): void {
        searchedQuery = findQuery;
        controller?.search?.find(findQuery);
    }

    function onFindInput(): void {
        clearTimeout(findTimer);
        findTimer = setTimeout(startSearch, 200);
    }

    function onFindKeydown(event: KeyboardEvent): void {
        if (event.key === "Enter") {
            event.preventDefault();
            clearTimeout(findTimer);
            if (findQuery.trim() === "") return;
            // The same key again goes to the next match; the first time, or after the text changed, it starts the search.
            if ($matches === undefined || findQuery !== searchedQuery) startSearch();
            else controller?.search?.next(event.shiftKey);
        } else if (event.key === "Escape") {
            toggleFind();
        }
    }

    function focusOnMount(node: HTMLElement) {
        node.focus();
    }

    function onWindowClick(event: MouseEvent): void {
        if (menuOpen && !(event.target as Element | null)?.closest?.("[data-file-menu]")) menuOpen = false;
    }

    function onKeydown(event: KeyboardEvent): void {
        if (event.key === "Escape" && menuOpen) {
            menuOpen = false;
            event.stopPropagation();
        }
    }

    // The game's keys (arrows, space) belong to the file while the person is working in the panel.
    function onFocusIn(): void {
        panelFocused = true;
        inputFormFocusStore.set(true);
    }

    function onFocusOut(event: FocusEvent): void {
        if (!root.contains(event.relatedTarget as Node | null)) {
            panelFocused = false;
            inputFormFocusStore.set(false);
        }
    }

    // A browser may not say that a focused control left (the search box closing, the menu closing). The panel keeps
    // the focus then, so the game's keys do not stay switched off with nothing focused.
    afterUpdate(() => {
        if (panelFocused && root && !root.contains(document.activeElement)) root.focus();
    });

    onMount(() => {
        void open();
    });

    onDestroy(() => {
        abort.abort();
        clearTimeout(findTimer);
        inputFormFocusStore.set(false);
        // The panel that filled a phone's screen gives it back.
        if (actualCowebsite.openedFullScreen) fullScreenCowebsite.set(false);
    });
</script>

<svelte:window on:click={onWindowClick} />

<!-- The panel only listens for focus and Escape, to hand the keys back and forth with the game. -->
<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<div
    bind:this={root}
    bind:clientWidth={panelWidth}
    class="viewer"
    class:compact
    class:hidden={!visible}
    role="dialog"
    aria-label={source.name}
    tabindex="-1"
    on:focusin={onFocusIn}
    on:focusout={onFocusOut}
    on:keydown={onKeydown}
    data-testid="fileViewer"
>
    <header class="vbar">
        {#if compact}
            {#if closable}
                <button
                    type="button"
                    class="ib"
                    title={$LL.chat.fileViewer.back()}
                    aria-label={$LL.chat.fileViewer.back()}
                    on:click={close}
                    data-testid="fileViewerBack"
                >
                    <IconArrowLeft font-size="20" />
                </button>
            {/if}
        {:else if kind === "pdf" || phase === "opening"}
            <button
                type="button"
                class="ib"
                title={$LL.chat.fileViewer.pageList()}
                aria-label={$LL.chat.fileViewer.pageList()}
                aria-pressed={$pageListShown}
                disabled={controller?.pageList === undefined}
                on:click={() => controller?.pageList?.toggle()}
            >
                <IconLayoutSidebar font-size="16" />
            </button>
        {:else}
            <span class="badge" style:background={badge.color}>{badge.label}</span>
        {/if}

        <div class="vtitle">
            <b>{source.name}</b>
            {#if subtitle}<small>{subtitle}</small>{/if}
        </div>

        {#if phase === "ready" && !compact && controller?.zoomPercent}
            <div class="zoom">
                <button
                    type="button"
                    aria-label={$LL.chat.fileViewer.zoomOut()}
                    on:click={() => controller?.zoomOut?.()}
                >
                    <IconMinus font-size="16" />
                </button>
                <span aria-live="polite">{$zoomPercent}%</span>
                <button type="button" aria-label={$LL.chat.fileViewer.zoomIn()} on:click={() => controller?.zoomIn?.()}>
                    <IconPlus font-size="16" />
                </button>
            </div>
        {/if}

        {#if phase === "ready" && controller?.search}
            <button
                type="button"
                class="ib"
                class:picked={findOpen}
                title={$LL.chat.fileViewer.search()}
                aria-label={$LL.chat.fileViewer.search()}
                aria-pressed={findOpen}
                on:click={toggleFind}
            >
                <IconSearch font-size={compact ? 18 : 16} />
            </button>
        {/if}

        {#if phase === "ready" && !compact && (controller?.fitWidth || controller?.rotate || controller?.print || canOpenInNewTab)}
            <div class="menu-anchor" data-file-menu>
                <button
                    type="button"
                    class="ib"
                    title={$LL.chat.fileViewer.more()}
                    aria-label={$LL.chat.fileViewer.more()}
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    on:click={() => (menuOpen = !menuOpen)}
                >
                    <IconDots font-size="16" />
                </button>
                {#if menuOpen}
                    <div class="menu" role="menu">
                        {#if controller?.fitWidth}
                            <button
                                type="button"
                                role="menuitem"
                                on:click={() => {
                                    menuOpen = false;
                                    controller?.fitWidth?.();
                                }}>{$LL.chat.fileViewer.fitWidth()}</button
                            >
                        {/if}
                        {#if controller?.rotate}
                            <button
                                type="button"
                                role="menuitem"
                                on:click={() => {
                                    menuOpen = false;
                                    controller?.rotate?.();
                                }}>{$LL.chat.fileViewer.rotate()}</button
                            >
                        {/if}
                        {#if controller?.print}
                            <button
                                type="button"
                                role="menuitem"
                                on:click={() => {
                                    menuOpen = false;
                                    void controller?.print?.();
                                }}>{$LL.chat.fileViewer.print()}</button
                            >
                        {/if}
                        {#if canOpenInNewTab}
                            <button type="button" role="menuitem" on:click={openInNewTab}
                                >{kind === "pdf"
                                    ? $LL.chat.fileViewer.openInNewTab()
                                    : $LL.chat.fileViewer.openPictureInNewTab()}</button
                            >
                        {/if}
                    </div>
                {/if}
            </div>
        {/if}

        {#if canDownload}
            <button
                type="button"
                class="ib"
                title={$LL.chat.fileViewer.download()}
                aria-label={$LL.chat.fileViewer.downloadFile({ name: source.name })}
                on:click={download}
                data-testid="fileViewerDownload"
            >
                <IconDownload font-size={compact ? 18 : 16} />
                {#if !compact}{$LL.chat.fileViewer.download()}{/if}
            </button>
        {/if}

        {#if !compact && closable}
            <button
                type="button"
                class="ib"
                title={$LL.chat.fileViewer.close()}
                aria-label={$LL.chat.fileViewer.close()}
                on:click={close}
                data-testid="fileViewerClose"
            >
                <IconX font-size="16" />
            </button>
        {/if}
    </header>

    {#if findOpen && phase === "ready" && controller?.search}
        <div class="findbar">
            <input
                class="find-input"
                type="search"
                inputmode="search"
                enterkeyhint="search"
                autocomplete="off"
                autocapitalize="off"
                spellcheck="false"
                placeholder={$LL.chat.fileViewer.searchPlaceholder()}
                aria-label={$LL.chat.fileViewer.search()}
                bind:value={findQuery}
                use:focusOnMount
                on:input={onFindInput}
                on:keydown={onFindKeydown}
            />
            {#if $matches}
                <small aria-live="polite">
                    {$matches.total > 0
                        ? $LL.chat.fileViewer.matchCount({ current: $matches.current, total: $matches.total })
                        : $LL.chat.fileViewer.noMatches()}
                </small>
            {/if}
        </div>
    {/if}

    {#if phase === "opening"}
        <div class="state" data-testid="fileViewerOpening">
            <div class="box" aria-busy="true">
                <span class="spin" />
                <b>{$LL.chat.fileViewer.opening()}</b>
            </div>
        </div>
    {:else if phase === "failed"}
        <div class="state" data-testid="fileViewerFailed">
            <div class="box">
                <b>{$LL.chat.fileViewer.cantPreview()}</b>
                <p>{isOldWord ? $LL.chat.fileViewer.oldWord() : $LL.chat.fileViewer.cantPreviewHelp()}</p>
                {#if canDownload}
                    <button type="button" class="bigbtn" on:click={download}>
                        <IconDownload font-size="18" />
                        {$LL.chat.fileViewer.download()}
                    </button>
                {/if}
                {#if canOpenInNewTab}
                    <button type="button" class="soft" on:click={openInNewTab}>
                        {$LL.chat.fileViewer.openPictureInNewTab()}
                    </button>
                {/if}
            </div>
        </div>
    {:else if bytes && kind === "pdf"}
        <FileViewerPdf
            {bytes}
            {compact}
            bind:controller
            on:loaded={(event) => (pageCount = event.detail.pageCount)}
            on:failed={onReaderFailed}
        />
    {:else if bytes && kind === "word"}
        <FileViewerWord
            {bytes}
            name={source.name}
            {compact}
            bind:controller
            on:loaded={(event) => (pageCount = event.detail.pageCount)}
            on:failed={onReaderFailed}
        />
    {:else if bytes && kind && TEXT_KINDS.has(kind)}
        <FileViewerText
            {bytes}
            {kind}
            on:loaded={(event) => (rowCount = event.detail.rowCount)}
            on:failed={onReaderFailed}
            on:download={download}
        />
    {:else if bytes && kind === "image"}
        <FileViewerImage {bytes} name={source.name} bind:controller on:failed={onReaderFailed} />
    {/if}
</div>

<style>
    .viewer {
        position: relative;
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        background: #1b1a2b;
        color: #f3f2fb;
        border-radius: 18px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
        font-family: Roboto, system-ui, -apple-system, "Segoe UI", sans-serif;
        outline: none;
    }

    .viewer.compact {
        border-radius: 0;
        box-shadow: none;
    }

    .viewer.hidden {
        display: none;
    }

    .vbar {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 10px;
        /* On a phone held upright the installed app's status bar is see-through: the toolbar starts under it. */
        padding-top: calc(10px + env(safe-area-inset-top, 0px));
        background: #201f33;
        border-bottom: 1px solid rgba(255, 255, 255, 0.07);
        flex: none;
    }

    .badge {
        width: 28px;
        height: 28px;
        border-radius: 6px;
        color: #fff;
        font-size: 8px;
        font-weight: 700;
        letter-spacing: 0.04em;
        display: grid;
        place-items: center;
        flex: none;
    }

    .vtitle {
        flex: 1;
        min-width: 72px;
    }

    .vtitle b {
        display: block;
        font-size: 14px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .vtitle small {
        display: block;
        color: #a3a1bd;
        font-size: 11px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .ib {
        height: 36px;
        min-width: 36px;
        padding: 0 10px;
        border: 0;
        border-radius: 10px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        color: #fff;
        background: rgba(255, 255, 255, 0.06);
        font: inherit;
        font-size: 13px;
        font-weight: 600;
        white-space: nowrap;
        cursor: pointer;
        flex: none;
    }

    .ib:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.12);
    }

    .ib:disabled {
        opacity: 0.4;
        cursor: default;
    }

    /* On, like a picked option: soft violet, never the gradient (that is for the one main button). */
    .ib.picked {
        background: rgba(134, 41, 252, 0.16);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.7);
    }

    .compact .ib {
        height: 44px;
        min-width: 44px;
        padding: 0;
    }

    .zoom {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        background: rgba(255, 255, 255, 0.06);
        border-radius: 10px;
        font-size: 12px;
        color: #a3a1bd;
        flex: none;
    }

    .zoom button {
        width: 30px;
        height: 36px;
        padding: 0;
        border: 0;
        background: transparent;
        color: #fff;
        display: grid;
        place-items: center;
        cursor: pointer;
    }

    .zoom span {
        min-width: 38px;
        text-align: center;
    }

    .menu-anchor {
        position: relative;
        flex: none;
    }

    .menu {
        position: absolute;
        right: 0;
        top: calc(100% + 8px);
        z-index: 5;
        width: 210px;
        padding: 6px;
        background: #262539;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 12px;
        box-shadow: 0 12px 30px rgba(0, 0, 0, 0.45);
    }

    .menu button {
        display: block;
        width: 100%;
        min-height: 36px;
        padding: 9px 10px;
        border: 0;
        border-radius: 8px;
        background: transparent;
        color: #fff;
        font: inherit;
        font-size: 13px;
        text-align: start;
        cursor: pointer;
    }

    .menu button:hover,
    .menu button:focus-visible {
        background: rgba(255, 255, 255, 0.08);
    }

    .findbar {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        background: #201f33;
        border-bottom: 1px solid rgba(255, 255, 255, 0.07);
        font-size: 13px;
        flex: none;
    }

    .find-input {
        flex: 1;
        min-width: 0;
        height: 36px;
        padding: 0 12px;
        border: 0;
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.08);
        color: #fff;
        font: inherit;
    }

    .compact .find-input {
        height: 44px;
    }

    .find-input:focus-visible {
        outline: 2px solid #b9a6ff;
        outline-offset: 0;
    }

    .findbar small {
        color: #a3a1bd;
        white-space: nowrap;
    }

    .state {
        flex: 1;
        display: grid;
        place-items: center;
        background: #3a3950;
        padding: 24px;
        text-align: center;
    }

    .state .box {
        background: #1b1a2b;
        border-radius: 16px;
        padding: 24px 20px;
        max-width: 260px;
        display: grid;
        gap: 10px;
        justify-items: center;
    }

    .state .box p {
        margin: 0;
        color: #a3a1bd;
        font-size: 13px;
        line-height: 1.45;
    }

    .state .box b {
        font-size: 15px;
    }

    .spin {
        width: 34px;
        height: 34px;
        border-radius: 50%;
        border: 3px solid rgba(255, 255, 255, 0.15);
        border-top-color: #b9a6ff;
        animation: file-viewer-spin 0.9s linear infinite;
    }

    @keyframes file-viewer-spin {
        to {
            transform: rotate(360deg);
        }
    }

    /* The one main button of the screen: gradient means go. */
    .bigbtn {
        height: 44px;
        padding: 0 18px;
        border: 0;
        border-radius: 12px;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        color: #fff;
        font: inherit;
        font-weight: 600;
        font-size: 14px;
        background: linear-gradient(90deg, #8629fc, #4156f6);
        cursor: pointer;
    }

    .soft {
        height: 44px;
        padding: 0 18px;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.06);
        color: #fff;
        font: inherit;
        font-weight: 600;
        font-size: 14px;
        cursor: pointer;
    }

    @media (prefers-reduced-motion: reduce) {
        .spin {
            animation-duration: 3s;
        }
    }
</style>
