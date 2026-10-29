<script lang="ts">
    import { onDestroy, onMount, tick } from "svelte";
    import LL from "../../../i18n/i18n-svelte";
    import { KLIPY_API_KEY } from "../../Enum/EnvironmentVariable";
    import { chatInputFocusStore } from "../../Stores/ChatStore";
    import type { GifCategory, GifItem, KlipyClient } from "./KlipyClient";
    import {
        fallbackCategories,
        fullRowCategories,
        gifColumnsFor,
        gifNeighbour,
        pickerWidthFor,
        shortestColumn,
        skeletonColumns,
        skeletonMoreRow,
        tileColumnsFor,
        tileNeighbour,
    } from "./GifLayout";
    import type { GridMove } from "./GifLayout";
    import { outsideClick } from "./GifOutsideClick";
    import {
        gifSessionOf,
        holdGifPicture,
        isGifPictureHeld,
        markGifSessionLoaded,
        sharedKlipyClient,
    } from "./GifSession";
    import { IconArrowLeft, IconSearch, IconTrendingUp, IconWifiOff, IconX } from "@wa-icons";

    /** Called with the link of the GIF the player tapped. */
    export let onPick: (url: string) => void;
    /** Called when the picker should close: Escape, or a click outside it. */
    export let onClose: (event?: Event) => void = () => {};
    /** Lets the tests give another Klipy. */
    export let client: KlipyClient | undefined = undefined;
    /** The chat panel the picker sits on: it is as wide as that panel, less a gap on each side. */
    export let anchor: HTMLElement | undefined = undefined;

    const klipy: KlipyClient | undefined = client ?? (KLIPY_API_KEY ? sharedKlipyClient(KLIPY_API_KEY) : undefined);
    // What was learnt the last time the picker opened, if that was in the last five minutes: the tiles and the
    // Trending tile's picture.
    const session = klipy ? gifSessionOf(klipy) : undefined;

    // The tiles of the first screen: undefined until Klipy has answered, the first time only.
    let categories: GifCategory[] | undefined = session?.categories;
    let trendingPreview: string | undefined = session?.trendingPreview;
    let query = "";
    // What the list on screen is for: the search it answers, or "" for the trending GIFs.
    let shownFor: string | undefined = undefined;
    let view: "home" | "results" = "home";
    // Every GIF of the list on screen, and the same GIFs split in columns.
    let items: GifItem[] = [];
    let columns: GifItem[][] = [[], []];
    let columnHeights = [0, 0];
    let page = 1;
    let hasNext = false;
    let loading = false;
    let failed = false;
    // The page that came back with an error: "Try again" asks for it again.
    let failedPage = 1;
    let empty = false;
    let scroller: HTMLDivElement;
    let searchInput: HTMLInputElement;
    // Whether this search box is what turned the game's keys off: only then is it for the picker to turn them on.
    let searchFocused = false;
    let abort: AbortController | undefined;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    // A new request makes the one before it stale, whatever order they answer in.
    let requestCounter = 0;

    // The width follows the chat panel (see pickerWidthFor); the columns follow the width.
    let anchorWidth: number | undefined = anchor ? anchor.getBoundingClientRect().width : undefined;
    let windowWidth = typeof window === "undefined" ? 1024 : window.innerWidth;
    $: wantedWidth = anchorWidth !== undefined && anchorWidth > 0 ? pickerWidthFor(anchorWidth) : undefined;
    $: width = Math.min(wantedWidth ?? 360, Math.max(0, windowWidth - 16));
    $: tileColumns = tileColumnsFor(width);
    $: gifColumns = gifColumnsFor(width);
    $: if (gifColumns !== columns.length) layout();

    // Every category Klipy sent, less what would sit alone on the last row.
    $: shownCategories = fullRowCategories(categories ?? [], tileColumns);
    $: tilesLoading = categories === undefined;
    $: tileCount = 1 + shownCategories.length;
    $: tileSkeletons = Array.from({ length: tileColumns === 3 ? 9 : 8 });
    $: gifSkeletons = skeletonColumns(gifColumns);
    $: moreSkeletons = skeletonMoreRow(gifColumns);
    // Three categories to try when a search finds nothing.
    $: suggestions = (categories ?? fallbackCategories()).slice(0, 3);

    function layout() {
        columns = Array.from({ length: gifColumns }, () => []);
        columnHeights = new Array<number>(gifColumns).fill(0);
        for (const item of items) place(item);
        columns = columns;
        columnHeights = columnHeights;
    }

    function place(item: GifItem) {
        const column = shortestColumn(columnHeights);
        columns[column] = [...columns[column], item];
        // Its height when it is as wide as the column.
        columnHeights[column] += item.previewHeight / item.previewWidth;
    }

    function reset() {
        items = [];
        columns = Array.from({ length: gifColumns }, () => []);
        columnHeights = new Array<number>(gifColumns).fill(0);
        page = 1;
        hasNext = false;
        failed = false;
        empty = false;
    }

    function addItems(more: GifItem[]) {
        const known = new Set(items.map((item) => item.id));
        for (const item of more) {
            if (known.has(item.id)) continue;
            known.add(item.id);
            items.push(item);
            place(item);
        }
        items = items;
        columns = columns;
        columnHeights = columnHeights;
    }

    async function load(forQuery: string, nextPage: number) {
        if (!klipy) return;
        abort?.abort();
        abort = new AbortController();
        const request = ++requestCounter;
        loading = true;
        failed = false;
        try {
            const result =
                forQuery === ""
                    ? await klipy.trending(nextPage, abort.signal)
                    : await klipy.search(forQuery, nextPage, abort.signal);
            if (request !== requestCounter) return;
            addItems(result.items);
            // A page with nothing to show ends the paging, so a strange answer can't loop.
            hasNext = result.hasNext && result.items.length > 0;
            page = nextPage;
            empty = items.length === 0;
            fillIfShort().catch((error) => console.error(error));
        } catch (error) {
            if (request !== requestCounter || (error instanceof DOMException && error.name === "AbortError")) return;
            console.error("Klipy request failed", error);
            failed = true;
            failedPage = nextPage;
        } finally {
            if (request === requestCounter) loading = false;
        }
    }

    function show(forQuery: string) {
        if (!klipy) return;
        view = "results";
        shownFor = forQuery;
        reset();
        if (scroller) scroller.scrollTop = 0;
        load(forQuery, 1).catch((error) => console.error(error));
    }

    function home() {
        clearTimeout(debounce);
        abort?.abort();
        requestCounter++;
        loading = false;
        query = "";
        view = "home";
        shownFor = undefined;
        reset();
    }

    function onInput() {
        clearTimeout(debounce);
        const typed = query.trim();
        if (typed === "") {
            home();
            return;
        }
        // Not on every key: one search once the typing pauses.
        debounce = setTimeout(() => show(typed), 300);
    }

    function onSearchKey(event: KeyboardEvent) {
        if (event.key === "Enter") {
            event.preventDefault();
            clearTimeout(debounce);
            const typed = query.trim();
            if (typed !== "") show(typed);
        } else if (event.key === "ArrowDown") {
            // From the search box into the grid.
            const first = scroller?.querySelector<HTMLElement>("[data-nav]");
            if (first) {
                event.preventDefault();
                first.focus();
            }
        }
    }

    const MOVES: Record<string, GridMove | undefined> = {
        ArrowLeft: "left",
        ArrowRight: "right",
        ArrowUp: "up",
        ArrowDown: "down",
    };

    /** The arrow keys move between the tiles, or between the GIFs, and up from the first row goes back to the search. */
    function onGridKey(event: KeyboardEvent) {
        const move = MOVES[event.key];
        const current = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-nav]") : null;
        if (!move || !current?.dataset.nav) return;
        const [kind, first, second] = current.dataset.nav.split(":");
        let next: string | undefined;
        let target: "search" | undefined;
        if (kind === "tile") {
            const found = tileNeighbour(Number(first), tileCount, tileColumns, move);
            if (found === "search") target = "search";
            else if (found !== undefined) next = `tile:${found}`;
        } else {
            const heights = columns.map((column) => column.map((item) => item.previewHeight / item.previewWidth));
            const found = gifNeighbour(heights, { column: Number(first), row: Number(second) }, move);
            if (found === "search") target = "search";
            else if (found !== undefined) next = `gif:${found.column}:${found.row}`;
        }
        event.preventDefault();
        if (target === "search") searchInput?.focus();
        else if (next) scroller.querySelector<HTMLElement>(`[data-nav="${next}"]`)?.focus();
    }

    function openCategory(category: GifCategory) {
        query = category.query;
        clearTimeout(debounce);
        show(category.query);
    }

    function openTrending() {
        query = "";
        clearTimeout(debounce);
        show("");
    }

    function retry() {
        if (shownFor === undefined) return;
        load(shownFor, failedPage).catch((error) => console.error(error));
    }

    function onScroll() {
        if (view !== "results" || loading || failed || !hasNext || shownFor === undefined) return;
        if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 240) {
            load(shownFor, page + 1).catch((error) => console.error(error));
        }
    }

    // The first screen only has tiles, so a tall panel can show a page that doesn't fill it: keep loading.
    async function fillIfShort() {
        await tick();
        if (view === "results" && scroller && !loading && !failed && hasNext && shownFor !== undefined) {
            if (scroller.scrollHeight <= scroller.clientHeight + 40) {
                load(shownFor, page + 1).catch((error) => console.error(error));
            }
        }
    }
    function pick(item: GifItem) {
        onPick(item.url);
    }

    function close(event?: Event) {
        onClose(event);
    }

    // Asked for when the picker is built (not once it is on the page), so the tiles are on their way sooner.
    if (klipy && session) {
        if (categories === undefined) {
            klipy
                .categories()
                .then((found) => {
                    if (found.length > 0) {
                        session.categories = found;
                        markGifSessionLoaded(session);
                    }
                    categories = session.categories ?? fallbackCategories();
                })
                .catch((error) => {
                    console.error("Klipy categories failed", error);
                    categories = fallbackCategories();
                });
        }
        if (trendingPreview === undefined) {
            klipy
                .trending(1)
                .then((first) => {
                    trendingPreview = first.items[0]?.previewUrl;
                    session.trendingPreview = trendingPreview;
                    if (trendingPreview) markGifSessionLoaded(session);
                    holdGifPicture(session, trendingPreview);
                })
                .catch((error) => console.error("Klipy trending failed", error));
        }
    } else {
        categories = fallbackCategories();
    }

    /** Follows the width of the chat panel the picker sits on. */
    function followAnchor(_node: HTMLElement) {
        if (!anchor || typeof ResizeObserver === "undefined") return {};
        const panel = anchor;
        // The whole box of the panel, borders and padding included.
        const observer = new ResizeObserver(() => {
            anchorWidth = panel.getBoundingClientRect().width;
        });
        observer.observe(panel);
        return { destroy: () => observer.disconnect() };
    }

    onMount(() => {
        // A phone's keyboard would cover the list: there the search is opened by a tap.
        if (window.matchMedia("(hover: hover)").matches) searchInput?.focus();
    });

    onDestroy(() => {
        clearTimeout(debounce);
        abort?.abort();
        // A search box that was focused when the picker closed doesn't send its blur. If the focus went to the
        // message box meanwhile (a sent GIF), that box has turned the keys off and keeps them so.
        if (searchFocused) chatInputFocusStore.set(false);
    });
</script>

<svelte:window
    bind:innerWidth={windowWidth}
    on:keydown={(event) => {
        if (event.key === "Escape") close();
    }}
/>

<div
    class="gif-picker u-surface pointer-events-auto"
    class:sized={wantedWidth !== undefined}
    style={wantedWidth !== undefined ? `width: ${width}px` : undefined}
    data-testid="gifPicker"
    role="dialog"
    aria-label={$LL.chat.gifPicker.title()}
    use:outsideClick={close}
    use:followAnchor
>
    <div class="search-row">
        {#if view === "results"}
            <button
                type="button"
                class="round-button"
                aria-label={$LL.chat.gifPicker.back()}
                data-testid="gifPickerBack"
                on:click={() => {
                    home();
                    searchInput?.focus();
                }}
            >
                <IconArrowLeft font-size={20} />
            </button>
        {/if}
        <label class="search">
            <IconSearch font-size={18} />
            <input
                bind:this={searchInput}
                bind:value={query}
                type="text"
                inputmode="search"
                enterkeyhint="search"
                autocomplete="off"
                autocapitalize="off"
                spellcheck="false"
                placeholder={$LL.chat.gifPicker.searchPlaceholder()}
                aria-label={$LL.chat.gifPicker.searchPlaceholder()}
                data-testid="gifPickerSearch"
                on:input={onInput}
                on:keydown={onSearchKey}
                on:focus={() => {
                    searchFocused = true;
                    chatInputFocusStore.set(true);
                }}
                on:blur={() => {
                    searchFocused = false;
                    chatInputFocusStore.set(false);
                }}
            />
            {#if query !== ""}
                <button
                    type="button"
                    class="clear"
                    aria-label={$LL.chat.gifPicker.clearSearch()}
                    on:click={() => {
                        home();
                        searchInput?.focus();
                    }}
                >
                    <IconX font-size={12} stroke-width={3} />
                </button>
            {/if}
        </label>
    </div>

    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div
        class="scroller"
        bind:this={scroller}
        on:scroll={onScroll}
        on:keydown={onGridKey}
        aria-busy={loading || (view === "home" && tilesLoading)}
    >
        {#if view === "home"}
            {#if tilesLoading}
                <div
                    class="tiles"
                    style="grid-template-columns: repeat({tileColumns}, 1fr)"
                    role="status"
                    aria-label={$LL.chat.gifPicker.loading()}
                    data-testid="gifPickerTilesLoading"
                >
                    {#each tileSkeletons as _, index (index)}
                        <div class="skeleton tile-skeleton" />
                    {/each}
                </div>
            {:else}
                <div class="tiles" style="grid-template-columns: repeat({tileColumns}, 1fr)">
                    <button
                        type="button"
                        class="tile trending"
                        data-testid="gifPickerTrending"
                        data-nav="tile:0"
                        on:click={openTrending}
                    >
                        {#if trendingPreview}
                            <img src={trendingPreview} alt="" draggable="false" referrerpolicy="no-referrer" />
                        {/if}
                        <span class="tile-label"><IconTrendingUp font-size={18} />{$LL.chat.gifPicker.trending()}</span>
                    </button>
                    {#each shownCategories as category, index (`${index}-${category.query}`)}
                        <button
                            type="button"
                            class="tile"
                            data-testid="gifPickerTile"
                            data-nav="tile:{index + 1}"
                            on:click={() => openCategory(category)}
                        >
                            {#if category.previewUrl}
                                <!-- The list is long: a picture loads when its tile comes into view, and is kept once
                                     loaded so the next opening shows it at once. -->
                                <img
                                    src={category.previewUrl}
                                    alt=""
                                    draggable="false"
                                    referrerpolicy="no-referrer"
                                    loading={isGifPictureHeld(session, category.previewUrl) ? undefined : "lazy"}
                                    on:load={() => session && holdGifPicture(session, category.previewUrl)}
                                />
                            {/if}
                            <span class="tile-label">{category.name}</span>
                        </button>
                    {/each}
                </div>
            {/if}
        {:else if loading && items.length === 0}
            <div
                class="columns"
                role="status"
                aria-label={$LL.chat.gifPicker.loading()}
                data-testid="gifPickerResultsLoading"
            >
                {#each gifSkeletons as column, index (index)}
                    <div class="column">
                        {#each column as ratio, row (row)}
                            <div class="skeleton gif-skeleton" style="aspect-ratio: {ratio}" />
                        {/each}
                    </div>
                {/each}
            </div>
        {:else}
            <div class="columns">
                {#each columns as column, columnIndex (columnIndex)}
                    <div class="column">
                        {#each column as item, row (item.id)}
                            <button
                                type="button"
                                class="gif"
                                data-testid="gifPickerItem"
                                data-nav="gif:{columnIndex}:{row}"
                                aria-label={$LL.chat.gifPicker.send({ title: item.title })}
                                style="aspect-ratio: {item.previewWidth} / {item.previewHeight}"
                                on:click={() => pick(item)}
                            >
                                <img
                                    src={item.previewUrl}
                                    alt={item.title}
                                    loading="lazy"
                                    draggable="false"
                                    referrerpolicy="no-referrer"
                                />
                            </button>
                        {/each}
                    </div>
                {/each}
            </div>
            {#if loading}
                <div
                    class="columns more"
                    role="status"
                    aria-label={$LL.chat.gifPicker.loading()}
                    data-testid="gifPickerMoreLoading"
                >
                    {#each moreSkeletons as ratio, index (index)}
                        <div class="column">
                            <div class="skeleton gif-skeleton" style="aspect-ratio: {ratio}" />
                        </div>
                    {/each}
                </div>
            {:else if failed}
                <div class="state" role="alert" data-testid="gifPickerError">
                    <span class="state-icon"><IconWifiOff font-size={28} /></span>
                    <span class="big">{$LL.chat.gifPicker.loadError()}</span>
                    <span>{$LL.chat.gifPicker.loadErrorHint()}</span>
                    <button type="button" class="u-cta-secondary retry" on:click={retry}>
                        {$LL.chat.gifPicker.retry()}
                    </button>
                </div>
            {:else if empty}
                <div class="state" data-testid="gifPickerEmpty">
                    {#if shownFor}
                        <span class="big">{$LL.chat.gifPicker.noResults({ query: shownFor })}</span>
                        <span>{$LL.chat.gifPicker.noResultsHint()}</span>
                        <div class="chips">
                            {#each suggestions as suggestion (suggestion.query)}
                                <button type="button" class="chip" on:click={() => openCategory(suggestion)}>
                                    {suggestion.name}
                                </button>
                            {/each}
                        </div>
                    {:else}
                        <span class="big">{$LL.chat.gifPicker.noTrending()}</span>
                    {/if}
                </div>
            {/if}
        {/if}
    </div>
</div>

<style>
    /* The width follows the chat panel (set inline once the panel is known, 360px until then). Tall enough for a
       few rows, but half the screen on a phone so the chat stays in view. */
    .gif-picker {
        /* The width is the whole box, padding included: the game has no global reset, and the picker would be
           20px wider than its chat panel allows and stick out on the left now that it sits on the right. */
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: min(360px, calc(100vw - 16px));
        height: min(480px, 60vh);
        min-height: 240px;
        padding: 10px 10px 0;
        border-radius: 20px;
        overflow: hidden;
        color: white;
    }
    /* The game's own button look (border, shadow, white fill) is not wanted on these. */
    .round-button,
    .clear,
    .tile,
    .gif,
    .chip {
        border: 0;
        box-shadow: none;
        cursor: pointer;
    }
    .round-button {
        background: transparent;
    }
    .search-row {
        display: flex;
        align-items: center;
        gap: 6px;
        flex: none;
    }
    .search {
        display: flex;
        flex: 1;
        align-items: center;
        gap: 8px;
        min-width: 0;
        height: 44px;
        padding: 0 12px;
        border-radius: 9999px;
        background: rgba(255, 255, 255, 0.08);
        border: 2px solid transparent;
        color: rgba(255, 255, 255, 0.7);
    }
    .search:focus-within {
        border-color: #7c6cf6;
    }
    .search input {
        flex: 1;
        min-width: 0;
        height: 100%;
        margin: 0;
        padding: 0;
        border: 0;
        outline: 0;
        box-shadow: none;
        background: transparent;
        color: white;
        /* 16px, or iPhones zoom the page when the box is focused. */
        font-size: 16px;
    }
    .search input::placeholder {
        color: rgba(255, 255, 255, 0.55);
    }
    .round-button,
    .clear {
        display: grid;
        place-items: center;
        flex: none;
        padding: 0;
        margin: 0;
        color: white;
    }
    .round-button {
        width: 44px;
        height: 44px;
        border-radius: 9999px;
    }
    .clear {
        width: 20px;
        height: 20px;
        border-radius: 9999px;
        background: rgba(255, 255, 255, 0.55);
        color: #14121e;
    }
    /* The keyboard ring sits 2px outside the edge: the padding (taken back by the margin) keeps it from being
       cut off by the scroll area. */
    .scroller {
        flex: 1;
        min-height: 0;
        margin: -4px -4px 0;
        overflow-y: auto;
        overscroll-behavior: contain;
        padding: 4px 4px 10px;
    }
    .tiles {
        display: grid;
        gap: 8px;
    }
    .tile {
        position: relative;
        height: 84px;
        margin: 0;
        padding: 0;
        border-radius: 12px;
        overflow: hidden;
        background: linear-gradient(135deg, #8b5cf6, #4156f6);
        color: white;
        transition: transform 0.12s;
    }
    .tile img {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        transition: filter 0.12s, transform 0.12s;
    }
    .tile::after {
        content: "";
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.36);
        transition: background 0.12s;
    }
    /* The white edge of a hovered or held tile. */
    .tile::before {
        content: "";
        position: absolute;
        inset: 0;
        z-index: 2;
        border-radius: 12px;
        box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0);
        transition: box-shadow 0.12s;
        pointer-events: none;
    }
    .tile-label {
        position: absolute;
        inset: 0;
        z-index: 3;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 0 8px;
        font-size: 15px;
        font-weight: 700;
        text-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
    }
    .tile:active {
        transform: scale(0.96);
    }
    .tile:active::after {
        background: rgba(0, 0, 0, 0.7);
    }
    .tile:active img {
        filter: blur(3px) brightness(0.85);
        transform: scale(1.06);
    }
    .tile:active::before {
        box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.75);
    }
    .columns {
        display: flex;
        gap: 6px;
        align-items: flex-start;
    }
    .columns.more {
        margin-top: 6px;
    }
    .column {
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: 6px;
        min-width: 0;
    }
    .gif {
        position: relative;
        display: block;
        width: 100%;
        margin: 0;
        padding: 0;
        border-radius: 10px;
        overflow: hidden;
        background: rgba(255, 255, 255, 0.08);
        transition: transform 0.12s, filter 0.12s;
    }
    .gif img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
    }
    /* The light white wash over the GIF under the mouse. */
    .gif::after {
        content: "";
        position: absolute;
        inset: 0;
        background: rgba(255, 255, 255, 0);
        transition: background 0.12s;
        pointer-events: none;
    }
    .gif:active {
        transform: scale(0.96);
        filter: brightness(0.7);
    }
    /* A hover look on a phone would stay on the last thing tapped: only where there is a mouse. */
    @media (hover: hover) {
        .tile:hover::after {
            background: rgba(10, 8, 20, 0.55);
        }
        .tile:hover img {
            filter: blur(3px) brightness(0.85);
            transform: scale(1.06);
        }
        .tile:hover::before {
            box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.75);
        }
        .gif:hover::after {
            background: rgba(255, 255, 255, 0.1);
        }
        .round-button:hover {
            background: rgba(255, 255, 255, 0.1);
        }
    }
    .gif:focus-visible,
    .tile:focus-visible,
    .round-button:focus-visible,
    .chip:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 2px;
    }
    /* The grey boxes of what is loading. The sheen that crosses them is faint on purpose. */
    .skeleton {
        position: relative;
        overflow: hidden;
        border-radius: 12px;
    }
    .skeleton::after {
        content: "";
        position: absolute;
        inset: 0;
        background: linear-gradient(100deg, transparent 20%, rgba(255, 255, 255, 0.08) 50%, transparent 80%);
        transform: translateX(-100%);
        animation: gif-shimmer 2s linear infinite;
    }
    .tile-skeleton {
        height: 84px;
        background: linear-gradient(135deg, #8b5cf6, #4156f6);
        opacity: 0.32;
    }
    .gif-skeleton {
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.07);
    }
    .gif-skeleton::after {
        background: linear-gradient(100deg, transparent 20%, rgba(255, 255, 255, 0.025) 50%, transparent 80%);
    }
    @keyframes gif-shimmer {
        to {
            transform: translateX(100%);
        }
    }
    .state {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        padding: 40px 16px;
        font-size: 14px;
        text-align: center;
        color: rgba(255, 255, 255, 0.62);
    }
    .state-icon {
        display: grid;
        color: white;
    }
    .state .big {
        font-size: 15px;
        font-weight: 600;
        color: white;
    }
    .retry {
        height: 44px;
        padding: 0 18px;
        border-radius: 9999px;
        font-size: 14px;
        font-weight: 600;
    }
    .chips {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 8px;
    }
    .chip {
        height: 44px;
        padding: 0 16px;
        border-radius: 9999px;
        background: rgba(255, 255, 255, 0.08);
        font-size: 14px;
        color: white;
    }
    @media (max-width: 640px) {
        .gif-picker {
            height: 50vh;
            height: 50dvh;
        }
        .gif-picker:not(.sized) {
            width: calc(100vw - 16px);
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .skeleton::after {
            animation: none;
        }
        .tile,
        .tile img,
        .tile::after,
        .tile::before,
        .gif,
        .gif::after {
            transition: none;
        }
    }
</style>
