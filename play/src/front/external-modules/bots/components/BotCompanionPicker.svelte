<script lang="ts">
    // The bot's companion (pet), picked inside the panel like the players' companion screen: a little room with the
    // bot walking and its pet behind it, the collections as pills, None then the companions as tiles, and Cancel /
    // Save. A tap only tries a companion on; Save keeps it, Cancel (or the back circle) leaves the bot as it was.
    import { onDestroy, onMount } from "svelte";
    import type { CompanionTexture } from "@workadventure/messages";
    import LL from "../../../../i18n/i18n-svelte";
    import { ABSOLUTE_PUSHER_URL } from "../../../Enum/ComputedConst";
    import { mobileLayoutStore } from "../../../Stores/MobileLayoutStore";
    import {
        botCompanionCatalogStore,
        ensureBotCompanionCatalog,
        findCompanion,
    } from "../stores/BotCompanionCatalogStore";
    import CompanionSprite from "./page/CompanionSprite.svelte";
    import { IconCheck, IconRefresh, IconShuffle } from "@wa-icons";

    /** The bot's companion, or null for none */
    export let selectedId: string | null = null;
    /** The bot's WOKA sheet, walking in the room */
    export let botUrl: string | undefined = undefined;
    export let onSave: (companionTextureId: string | null) => void;
    export let onCancel: () => void;

    $: page = $LL.mapEditor.edit.bots.page.companion;
    $: catalog = $botCompanionCatalogStore;
    $: collections = (catalog ?? []).filter((collection) => collection.textures.length > 0);

    // What is tried on, until Save
    let draftId: string | null = selectedId;
    $: draft = findCompanion(catalog, draftId);

    // Opens on the collection holding the bot's companion
    let collectionIndex = 0;
    let openedOnCompanion = false;
    $: if (!openedOnCompanion && catalog) {
        openedOnCompanion = true;
        const index = collections.findIndex((collection) => collection.textures.some((t) => t.id === draftId));
        if (index >= 0) collectionIndex = index;
    }
    $: textures = collections[Math.min(collectionIndex, Math.max(collections.length - 1, 0))]?.textures ?? [];
    // None, then the collection's companions: what the arrow keys walk through
    $: choices = [null, ...textures] as (CompanionTexture | null)[];

    // Phone and computer sizes of the room, the two walking in it and the tiles
    $: phone = $mobileLayoutStore;
    $: stageHeight = phone ? 132 : 170;
    $: botSize = phone ? 56 : 72;
    $: petSize = Math.round(botSize * 0.8);
    $: tileSprite = phone ? 44 : 60;
    $: columns = phone ? 3 : 4;

    // Rotate turns the two round: right, down, left, up. The pet walks behind the bot.
    const directions = [2, 0, 1, 3];
    let directionIndex = 0;
    $: row = directions[directionIndex];

    function rotate() {
        directionIndex = (directionIndex + 1) % directions.length;
    }

    function randomize() {
        const others = textures.filter((t) => t.id !== draftId);
        if (others.length === 0) return;
        draftId = others[Math.floor(Math.random() * others.length)].id;
    }

    function choose(id: string | null) {
        draftId = id;
    }

    function save() {
        onSave(draftId);
    }

    function textureUrl(url: string): string {
        if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:")) {
            return url;
        }
        return `${ABSOLUTE_PUSHER_URL}${url.replace(/^\//, "")}`;
    }

    // The scroll bar beside the tiles, drawn like the join screens' (the browser's own is hidden)
    let scroller: HTMLDivElement | undefined;
    let thumbTop = 0;
    let thumbHeight = 100;
    function syncScrollBar() {
        if (!scroller) return;
        const { scrollTop, scrollHeight, clientHeight } = scroller;
        thumbHeight = scrollHeight > 0 ? Math.min(100, (clientHeight / scrollHeight) * 100) : 100;
        thumbTop = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;
    }
    let resizeObserver: ResizeObserver | undefined;
    $: if (scroller && choices) requestAnimationFrame(syncScrollBar);
    // The tiles come in with the room's list, after the picker opens
    $: if (scroller && resizeObserver) resizeObserver.observe(scroller);

    // Keyboard on a computer: the arrows move between tiles, Enter saves. Escape goes back (the bot page handles it).
    function onKeyDown(event: KeyboardEvent) {
        const target = event.target;
        if (
            target instanceof HTMLInputElement ||
            target instanceof HTMLTextAreaElement ||
            (target instanceof HTMLElement && target.isContentEditable)
        ) {
            return;
        }
        if (event.key === "Enter") {
            // Enter on another button (Cancel, a pill) does that button's job
            if (target instanceof HTMLButtonElement && !target.dataset.cpTile) return;
            event.preventDefault();
            event.stopPropagation();
            save();
            return;
        }
        if (!event.key.startsWith("Arrow")) return;
        const index = choices.findIndex((choice) => (choice?.id ?? null) === draftId);
        let next = index;
        if (index === -1) next = Math.min(1, choices.length - 1);
        else if (event.key === "ArrowLeft") next = Math.max(index - 1, 0);
        else if (event.key === "ArrowRight") next = Math.min(index + 1, choices.length - 1);
        else if (event.key === "ArrowUp") next = Math.max(index - columns, 0);
        else if (event.key === "ArrowDown") next = Math.min(index + columns, choices.length - 1);
        else return;
        // The arrows move the tiles here, not the map behind
        event.preventDefault();
        event.stopPropagation();
        if (next !== index || index === -1) {
            choose(choices[next]?.id ?? null);
            document.getElementById(`bot-companion-tile-${choices[next]?.id ?? "none"}`)?.focus();
        }
    }

    onMount(() => {
        void ensureBotCompanionCatalog();
        window.addEventListener("keydown", onKeyDown, true);
        resizeObserver = new ResizeObserver(syncScrollBar);
    });

    onDestroy(() => {
        window.removeEventListener("keydown", onKeyDown, true);
        resizeObserver?.disconnect();
    });
</script>

<div class="cp" class:cp-phone={phone} data-testid="bot-companion-picker">
    <!-- The room: the bot walking, its pet behind it, Rotate and Randomize in the corner -->
    <div class="cp-stage" style="height: {stageHeight}px" data-testid="bot-companion-preview">
        <div class="cp-wall" />
        <div class="cp-floor" />
        <div
            class="cp-walkers"
            class:cp-reverse={row === 1}
            style="bottom: {Math.round(stageHeight * 0.13)}px; gap: {Math.round(botSize * 0.06)}px"
        >
            {#if draft}
                <CompanionSprite url={textureUrl(draft.url)} size={petSize} {row} walking />
            {/if}
            {#if botUrl}
                <CompanionSprite url={botUrl} size={botSize} {row} walking />
            {/if}
        </div>
        <div class="cp-tools">
            <button
                type="button"
                class="cp-tool"
                title={page.rotate()}
                aria-label={page.rotate()}
                data-testid="bot-companion-rotate"
                on:click={rotate}
            >
                <IconRefresh font-size="16" />
            </button>
            <button
                type="button"
                class="cp-tool"
                title={page.randomize()}
                aria-label={page.randomize()}
                data-testid="bot-companion-randomize"
                on:click={randomize}
            >
                <IconShuffle font-size="16" />
            </button>
        </div>
    </div>

    {#if catalog === null}
        <div class="cp-loading"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-white" /></div>
    {:else}
        <!-- One collection at a time, as on the join screen -->
        {#if collections.length > 1}
            <div class="cp-pills" role="tablist">
                {#each collections as collection, index (collection.name)}
                    <button
                        type="button"
                        role="tab"
                        class="cp-pill"
                        aria-selected={index === collectionIndex}
                        on:click={() => (collectionIndex = index)}
                    >
                        {collection.name}
                        <b>{collection.textures.length}</b>
                    </button>
                {/each}
            </div>
        {/if}

        <div class="cp-scroll">
            <div class="cp-clip" bind:this={scroller} on:scroll={syncScrollBar}>
                <div
                    class="cp-grid"
                    style="grid-template-columns: repeat({columns}, minmax(0, 1fr))"
                    role="radiogroup"
                    aria-label={page.change()}
                >
                    <button
                        type="button"
                        role="radio"
                        id="bot-companion-tile-none"
                        class="cp-tile cp-none"
                        aria-checked={draftId === null}
                        data-cp-tile="none"
                        data-testid="bot-companion-none"
                        on:click={() => choose(null)}
                    >
                        <svg class="cp-ban" viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" />
                            <path d="M5.7 5.7l12.6 12.6" />
                        </svg>
                        <span>{page.noneOption()}</span>
                        {#if draftId === null}
                            <span class="cp-ck"><IconCheck font-size="12" /></span>
                        {/if}
                    </button>
                    {#each textures as texture (texture.id)}
                        <button
                            type="button"
                            role="radio"
                            id="bot-companion-tile-{texture.id}"
                            class="cp-tile cp-named"
                            aria-checked={draftId === texture.id}
                            aria-label={texture.name}
                            data-cp-tile={texture.id}
                            data-testid="bot-companion-{texture.id}"
                            on:click={() => choose(texture.id)}
                        >
                            <CompanionSprite url={textureUrl(texture.url)} size={tileSprite} />
                            <span class="cp-name">{texture.name}</span>
                            {#if draftId === texture.id}
                                <span class="cp-ck"><IconCheck font-size="12" /></span>
                            {/if}
                        </button>
                    {/each}
                </div>
                {#if collections.length === 0}
                    <p class="cp-empty">{page.empty()}</p>
                {/if}
            </div>
            <span class="cp-sbar" aria-hidden="true">
                <i style="top: {thumbTop}%; height: {thumbHeight}%" />
            </span>
        </div>
    {/if}

    <div class="cp-foot">
        {#if !phone}
            <span class="cp-hint">
                <span class="cp-kbd">←</span><span class="cp-kbd">→</span>
                {page.browse()} ·
                <span class="cp-kbd">Enter</span>
                {page.saveHint()}
            </span>
        {/if}
        <button type="button" class="cp-btn" data-testid="bot-companion-cancel" on:click={onCancel}>
            {page.cancel()}
        </button>
        <button type="button" class="cp-btn cp-cta" data-testid="bot-companion-save" on:click={save}>
            {page.save()}
        </button>
    </div>
</div>

<style>
    /* Fills the panel under its title, with Cancel and Save at the bottom */
    .cp {
        display: flex;
        flex-direction: column;
        gap: 12px;
        flex: 1;
        min-height: 0;
        padding-top: 6px;
        color: #fff;
    }
    .cp.cp-phone {
        gap: 10px;
    }
    /* The join screen's room: a wall with a rail, a floor sliding by so the two walk on the spot */
    .cp-stage {
        position: relative;
        flex: none;
        overflow: hidden;
        border-radius: 16px;
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
    }
    .cp-wall {
        position: absolute;
        left: 0;
        right: 0;
        top: 0;
        height: 58%;
        background: linear-gradient(180deg, #1a1628, #211b33);
    }
    .cp-wall::before {
        content: "";
        position: absolute;
        left: 0;
        right: 0;
        bottom: 16px;
        height: 5px;
        background: rgba(167, 139, 250, 0.12);
    }
    .cp-floor {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        height: 42%;
        border-top: 2px solid rgba(167, 139, 250, 0.25);
        background: linear-gradient(180deg, rgba(10, 8, 20, 0), rgba(10, 8, 20, 0.35)),
            repeating-linear-gradient(90deg, #2a2440 0 40px, #262038 40px 80px);
        animation: cp-floor 1.6s linear infinite;
    }
    @keyframes cp-floor {
        from {
            background-position: 0 0, 0 0;
        }
        to {
            background-position: 0 0, -80px 0;
        }
    }
    .cp-walkers {
        position: absolute;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        align-items: flex-end;
    }
    /* Walking left, the pet follows on the right */
    .cp-walkers.cp-reverse {
        flex-direction: row-reverse;
    }
    .cp-tools {
        position: absolute;
        right: 8px;
        bottom: 8px;
        z-index: 3;
        display: flex;
        gap: 6px;
    }
    .cp-tool {
        display: grid;
        place-items: center;
        width: 32px;
        height: 32px;
        margin: 0;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: rgba(10, 8, 20, 0.55);
        backdrop-filter: blur(6px);
        -webkit-backdrop-filter: blur(6px);
        color: #fff;
        cursor: pointer;
    }
    /* Pills: the join screen's, with the count */
    .cp-pills {
        display: flex;
        flex: none;
        gap: 6px;
        overflow-x: auto;
        scrollbar-width: none;
    }
    .cp-pills::-webkit-scrollbar {
        display: none;
    }
    .cp-pill {
        display: flex;
        flex: none;
        align-items: center;
        gap: 6px;
        height: 32px;
        margin: 0;
        padding: 0 12px;
        border: 0;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.06);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
        font: inherit;
        font-size: 13px;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.78);
        white-space: nowrap;
        cursor: pointer;
    }
    .cp-pill b {
        font-size: 11.5px;
        color: rgba(255, 255, 255, 0.55);
    }
    .cp-pill[aria-selected="true"] {
        background: linear-gradient(135deg, #8629fc, #4156f6);
        box-shadow: 0 6px 18px -6px rgba(134, 41, 252, 0.9);
        color: #fff;
    }
    .cp-pill[aria-selected="true"] b {
        color: rgba(255, 255, 255, 0.85);
    }
    /* The tiles scroll down with a fade at the bottom and a thin bar beside them */
    /* As tall as the mock's (three and a half rows), shorter on a small screen */
    .cp-scroll {
        position: relative;
        flex: 0 1 452px;
        min-height: 0;
        margin-right: 10px;
    }
    .cp-phone .cp-scroll {
        flex-basis: 384px;
    }
    .cp-clip {
        height: 100%;
        overflow-y: auto;
        border-radius: 14px;
        scrollbar-width: none;
        /* The last 30px fade into the panel, so a cut-off row reads as more below */
        -webkit-mask-image: linear-gradient(180deg, #000 calc(100% - 30px), rgb(0 0 0 / 0.15));
        mask-image: linear-gradient(180deg, #000 calc(100% - 30px), rgb(0 0 0 / 0.15));
    }
    .cp-clip::-webkit-scrollbar {
        display: none;
    }
    .cp-sbar {
        position: absolute;
        top: 4px;
        bottom: 4px;
        right: -9px;
        width: 4px;
        border-radius: 2px;
        background: rgba(255, 255, 255, 0.08);
    }
    .cp-sbar i {
        position: absolute;
        left: 0;
        right: 0;
        border-radius: 2px;
        background: rgba(196, 181, 253, 0.7);
    }
    .cp-grid {
        display: grid;
        gap: 8px;
    }
    .cp-tile {
        position: relative;
        display: grid;
        place-items: center;
        aspect-ratio: 1;
        min-width: 0;
        margin: 0;
        padding: 0;
        border: 0;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.04);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
        color: #fff;
        cursor: pointer;
    }
    @media (hover: hover) {
        .cp-tile:hover {
            background: rgba(255, 255, 255, 0.09);
        }
    }
    .cp-tile[aria-checked="true"] {
        background: linear-gradient(145deg, rgba(134, 41, 252, 0.28), rgba(65, 86, 246, 0.18));
        box-shadow: inset 0 0 0 2px rgba(196, 181, 253, 0.95), 0 8px 22px -10px rgba(134, 41, 252, 0.9);
    }
    .cp-tile:focus-visible {
        outline: 2px solid #fff;
        outline-offset: 2px;
    }
    .cp-none {
        align-content: center;
        gap: 2px;
        font-size: 12px;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.85);
    }
    .cp-ban {
        width: 24px;
        height: 24px;
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
    }
    .cp-named {
        padding-bottom: 16px;
    }
    .cp-name {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 5px;
        overflow: hidden;
        padding: 0 4px;
        text-align: center;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 11.5px;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.75);
    }
    .cp-ck {
        position: absolute;
        top: 5px;
        right: 5px;
        display: grid;
        place-items: center;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: linear-gradient(135deg, #8629fc, #4156f6);
        color: #fff;
    }
    .cp-loading {
        display: flex;
        flex: 1;
        align-items: center;
        justify-content: center;
    }
    .cp-empty {
        margin: 12px 0 0;
        font-size: 13px;
        color: rgba(255, 255, 255, 0.6);
    }
    /* Cancel and Save, halves on a phone; the keyboard hint first on a computer */
    .cp-foot {
        display: grid;
        flex: none;
        grid-template-columns: auto 1fr 1fr;
        align-items: center;
        gap: 8px;
        margin-top: auto;
        padding: 4px 0 2px;
    }
    .cp-phone .cp-foot {
        grid-template-columns: 1fr 1fr;
    }
    .cp-hint {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        font-weight: 500;
        color: rgba(255, 255, 255, 0.55);
        white-space: nowrap;
    }
    .cp-kbd {
        display: inline-grid;
        place-items: center;
        min-width: 20px;
        height: 20px;
        padding: 0 5px;
        border-radius: 5px;
        background: rgba(255, 255, 255, 0.08);
        font-size: 11px;
        font-weight: 700;
        color: rgba(255, 255, 255, 0.75);
    }
    .cp-btn {
        height: 44px;
        margin: 0;
        padding: 0 14px;
        border: 0;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        color: #fff;
        white-space: nowrap;
        cursor: pointer;
    }
    .cp-cta {
        background: linear-gradient(90deg, #8629fc, #4156f6);
        box-shadow: 0 8px 24px -10px rgba(134, 41, 252, 0.8);
    }
    .cp-btn:focus-visible,
    .cp-tool:focus-visible,
    .cp-pill:focus-visible {
        outline: 2px solid #fff;
        outline-offset: 2px;
    }
    @media (prefers-reduced-motion: reduce) {
        .cp-floor {
            animation: none;
        }
    }
</style>
