<script lang="ts">
    import { onDestroy, onMount, tick } from "svelte";
    import type { WokaMine } from "@workadventure/messages";
    import { LL } from "../../../i18n/i18n-svelte";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { joinDesktopStore } from "../../Stores/JoinDesktopStore";
    import type { WokaCollection, WokaData, WokaTexture } from "./WokaTypes";
    import WokaImage from "./WokaImage.svelte";
    import WokaCard from "./WokaCard.svelte";
    import { fetchWokaData, fetchWokaMine, getWokaTextureUrl } from "./WokaData";
    import { IconCheck, IconPencil } from "@wa-icons";

    export let customize: () => void;
    export let saveAndContinue: (texturesId: string[]) => void;
    export let close: (() => void) | undefined = undefined;
    /** Why the last Continue did not save, shown above the buttons */
    export let saveError = "";

    /** At most this many Recent tiles, in one row (Orbit already caps, filters and orders them) */
    const maxRecent = 4;

    let wokaData: WokaData | null = null;
    // The collection pill on screen (Recent is a row above the pills, not a pill)
    let category = 0;
    let selectedId = "";
    // A Recent tile is a whole outfit (several layers): the one picked, or null when a catalog tile is
    let recent: WokaMine["recent"] = [];
    let selectedRecent: number | null = null;
    let isLoading = true;
    let error = "";
    let direction = 0;

    $: tileSize = $joinDesktopStore ? 64 : 52;

    $: hasRecent = recent.length > 0;
    $: collections = wokaData?.woka?.collections ?? [];
    $: textures = collections[category]?.textures ?? [];
    $: categories = collections.map((collection) => ({ label: collection.name, count: collection.textures.length }));
    $: selectedTextures = { woka: selectedId };
    $: previewLayers =
        selectedRecent !== null ? recent[selectedRecent]?.textures.map((texture) => texture.url) ?? null : null;

    async function loadWokaData() {
        isLoading = true;
        error = "";
        try {
            // What you wore lately is asked each time the picker opens (it changes with every pick); a failure just
            // leaves Recent out
            const [data, mine] = await Promise.all([fetchWokaData({ fresh: true }), fetchWokaMine()]);
            wokaData = data;
            recent = (mine?.recent ?? []).filter((outfit) => outfit.textures.length > 0).slice(0, maxRecent);
            loadSavedTexture();
        } catch (err) {
            console.error("Error loading Woka data:", err);
            error = $LL.woka.selectWoka.loadError();
        } finally {
            isLoading = false;
        }
        await tick();
        // The row does not scroll; only a checked tile further down the grid needs to come into view
        if (selectedRecent === null)
            document.getElementById(`woka-${selectedId}`)?.scrollIntoView({ block: "nearest" });
    }

    function findTexture(
        list: WokaCollection[],
        id: string | undefined
    ): { collectionIndex: number; texture: WokaTexture } | undefined {
        if (!id) return undefined;
        for (const [index, collection] of list.entries()) {
            const texture = collection.textures.find((t) => t.id === id);
            if (texture) return { collectionIndex: index, texture };
        }
        return undefined;
    }

    // Opens on the WOKA you have, or the first one. With a Recent row, the one you wear now is checked there and the
    // grid opens on its collection (Default when it is a built outfit, which no collection holds).
    function loadSavedTexture() {
        const list = wokaData?.woka?.collections ?? [];
        const now = recent.findIndex((outfit) => outfit.current);
        if (now !== -1) {
            const layers = recent[now].textures;
            category = (layers.length === 1 ? findTexture(list, layers[0].id)?.collectionIndex : undefined) ?? 0;
            selectedRecent = now;
            selectedId = "";
            return;
        }
        const saved = findTexture(list, gameManager.getCharacterTextureIds()?.[0]);
        category = saved?.collectionIndex ?? 0;
        selectedRecent = null;
        selectedId = saved?.texture.id ?? list[0]?.textures[0]?.id ?? "";
    }

    function select(id: string) {
        selectedId = id;
        selectedRecent = null;
        document.getElementById(`woka-${id}`)?.scrollIntoView({ block: "nearest" });
    }

    function selectRecent(index: number) {
        selectedRecent = index;
        document.getElementById(`woka-recent-${index}`)?.scrollIntoView({ block: "nearest" });
    }

    // Randomize picks from every collection and shows the one it landed in
    async function randomize() {
        const all = collections.flatMap((collection, index) => collection.textures.map((t) => ({ index, t })));
        if (all.length === 0) return;
        const pick = all[Math.floor(Math.random() * all.length)];
        // Through the card, so the collection's pill scrolls into view too
        if (card) await card.selectCategory(pick.index);
        else category = pick.index;
        await tick();
        select(pick.t.id);
    }

    let card: WokaCard | undefined;

    // Tiles per row (the Recent row and the grid draw the same columns)
    function columns(): number {
        const grid = document.getElementById("woka-grid");
        if (!grid) return 1;
        return getComputedStyle(grid).gridTemplateColumns.split(" ").length;
    }

    function save() {
        // A Recent tile is a whole outfit: Continue saves exactly its texture ids
        const outfit = selectedRecent !== null ? recent[selectedRecent] : undefined;
        if (outfit) saveAndContinue(outfit.textures.map((texture) => texture.id));
        else if (selectedId) saveAndContinue([selectedId]);
    }

    let enterPressed = false;

    function onKeyDown(event: KeyboardEvent) {
        if (!wokaData || event.target instanceof HTMLInputElement) return;
        const onRecent = selectedRecent !== null;
        const count = onRecent ? recent.length : textures.length;
        const index = onRecent ? selectedRecent ?? -1 : textures.findIndex((t) => t.id === selectedId);
        const wide = columns();
        let next = index;
        if (event.key === "ArrowLeft") next = Math.max(index - 1, 0);
        else if (event.key === "ArrowRight") next = Math.min(index + 1, count - 1);
        else if (event.key === "ArrowUp") {
            // From the top row of the grid, up goes into the Recent row, to the tile above (or the last one)
            if (!onRecent && hasRecent && index >= 0 && index < wide) {
                event.preventDefault();
                selectRecent(Math.min(index, recent.length - 1));
                return;
            }
            next = Math.max(index - wide, 0);
        } else if (event.key === "ArrowDown") {
            // From the Recent row, down goes into the grid, to the tile below (or the last one)
            if (onRecent && textures.length > 0) {
                event.preventDefault();
                select(textures[Math.min(index, textures.length - 1)].id);
                return;
            }
            next = Math.min(index + wide, count - 1);
        } else if (event.key === "Enter") {
            // A focused button (Randomize, Build, Save…) does its own job on Enter; tiles let Enter save
            if (event.target instanceof HTMLButtonElement && event.target.getAttribute("role") !== "radio") return;
            enterPressed = true;
            return;
        } else return;
        event.preventDefault();
        if (next === index) return;
        if (onRecent) {
            if (recent[next]) selectRecent(next);
        } else if (textures[next]) select(textures[next].id);
    }

    function onKeyUp(event: KeyboardEvent) {
        // On key up, so the Enter that saves does not reach the next screen
        if (event.key === "Enter" && enterPressed) {
            enterPressed = false;
            save();
        }
    }

    onMount(() => {
        loadWokaData().catch((err) => console.error(err));
        document.addEventListener("keydown", onKeyDown);
        document.addEventListener("keyup", onKeyUp);
    });

    onDestroy(() => {
        document.removeEventListener("keydown", onKeyDown);
        document.removeEventListener("keyup", onKeyUp);
    });
</script>

<WokaCard
    bind:this={card}
    eyebrow={$LL.woka.selectWoka.eyebrow()}
    title={$LL.woka.selectWoka.heading()}
    {selectedTextures}
    {previewLayers}
    {saveError}
    {wokaData}
    {isLoading}
    {error}
    retry={loadWokaData}
    {randomize}
    {close}
    {categories}
    bind:category
    swipeHint={$LL.woka.selectWoka.swipeHint()}
    bind:direction
>
    <svelte:fragment slot="hint">
        <span class="u-join-kbd">←</span>
        <span class="u-join-kbd">→</span>
        {$LL.woka.selectWoka.browse()} ·
        <span class="u-join-kbd">Enter</span>
        {$LL.woka.selectWoka.save()}
    </svelte:fragment>

    <!-- Recent: one row above the pills. It never scrolls or swipes; one tile is checked across the row and the grid -->
    <svelte:fragment slot="recent">
        {#if hasRecent}
            <div class="woka-recent-row mb-1 md:mb-0.5">
                <p class="woka-recent-label">{$LL.woka.selectWoka.recentLabel()}</p>
                <div
                    class="grid grid-cols-4 md:grid-cols-6 gap-2 p-1"
                    role="radiogroup"
                    aria-label={$LL.woka.selectWoka.recentLabel()}
                >
                    {#each recent as outfit, outfitIndex (outfitIndex)}
                        <button
                            type="button"
                            role="radio"
                            id={`woka-recent-${outfitIndex}`}
                            class="u-join-tile"
                            aria-checked={selectedRecent === outfitIndex}
                            aria-label={outfit.name ?? $LL.woka.refused.yourWoka()}
                            on:click={() => selectRecent(outfitIndex)}
                        >
                            <WokaImage
                                selectedTextures={{}}
                                layers={outfit.textures.map((texture) => texture.url)}
                                getTextureUrl={getWokaTextureUrl}
                                canvasSize={tileSize}
                                {direction}
                            />
                            {#if outfit.current}
                                <span class="woka-now">{$LL.woka.selectWoka.now()}</span>
                            {/if}
                            {#if selectedRecent === outfitIndex}
                                <span class="u-join-tile-check"><IconCheck font-size="12" /></span>
                            {/if}
                        </button>
                    {/each}
                </div>
            </div>
        {/if}
    </svelte:fragment>

    <!-- The card also draws the collections on either side, ready to slide in: only the one on screen has the ids -->
    <div
        slot="tiles"
        let:index
        let:active
        id={active ? "woka-grid" : undefined}
        class="grid grid-cols-4 md:grid-cols-6 gap-2 p-1"
        role="radiogroup"
        aria-label={$LL.woka.selectWoka.heading()}
    >
        {#each collections[index]?.textures ?? [] as texture (texture.id)}
            <button
                type="button"
                role="radio"
                id={active ? `woka-${texture.id}` : undefined}
                class="u-join-tile"
                aria-checked={selectedRecent === null && selectedId === texture.id}
                aria-label={texture.name}
                on:click={() => select(texture.id)}
            >
                <WokaImage
                    selectedTextures={{ woka: texture.id }}
                    {wokaData}
                    getTextureUrl={getWokaTextureUrl}
                    canvasSize={tileSize}
                    {direction}
                />
                {#if selectedRecent === null && selectedId === texture.id}
                    <span class="u-join-tile-check"><IconCheck font-size="12" /></span>
                {/if}
            </button>
        {/each}
    </div>

    <svelte:fragment slot="footer">
        <button type="button" class="u-join-btn u-cta-secondary wokaBuildButton !px-3 md:!px-5" on:click={customize}>
            <IconPencil font-size="16" />
            <span class="md:hidden">{$LL.woka.selectWoka.build()}</span>
            <span class="hidden md:inline">{$LL.woka.selectWoka.customize()}</span>
        </button>
        <button
            type="button"
            class="u-join-btn u-cta md:min-w-[180px] selectCharacterSceneFormSubmit"
            disabled={!selectedId && selectedRecent === null}
            on:click={save}
        >
            {$LL.woka.selectWoka.continue()}
        </button>
    </svelte:fragment>
</WokaCard>

<style>
    .woka-recent-row {
        margin-right: 12px;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    .woka-recent-label {
        margin: 0;
        padding: 0 4px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.5);
    }
    /* "Now": marks the WOKA you wear at the bottom of its tile */
    .woka-now {
        position: absolute;
        left: 50%;
        bottom: 4px;
        transform: translateX(-50%);
        padding: 0 7px;
        border-radius: 9999px;
        background: rgba(10, 8, 20, 0.8);
        font-size: 10px;
        font-weight: 700;
        color: #c4b5fd;
    }
</style>
