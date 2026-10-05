<script lang="ts">
    import { onDestroy, onMount, tick } from "svelte";
    import { LL } from "../../../i18n/i18n-svelte";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import type { WokaCollection, WokaData, WokaTexture } from "./WokaTypes";
    import WokaImage from "./WokaImage.svelte";
    import WokaCard from "./WokaCard.svelte";
    import { fetchWokaData, getWokaTextureUrl } from "./WokaData";
    import { IconCheck, IconPencil } from "@wa-icons";

    export let customize: () => void;
    export let saveAndContinue: (texturesId: string[]) => void;
    export let close: (() => void) | undefined = undefined;

    let wokaData: WokaData | null = null;
    let collectionIndex = 0;
    let selectedId = "";
    let isLoading = true;
    let error = "";
    let direction = 0;

    const isDesktop = window.matchMedia("(min-width: 768px)").matches;
    const tileSize = isDesktop ? 64 : 52;

    $: collections = wokaData?.woka?.collections ?? [];
    $: textures = collections[collectionIndex]?.textures ?? [];
    $: categories = collections.map((collection) => ({ label: collection.name, count: collection.textures.length }));
    $: selectedTextures = { woka: selectedId };

    async function loadWokaData() {
        isLoading = true;
        error = "";
        try {
            wokaData = await fetchWokaData();
            loadSavedTexture();
        } catch (err) {
            console.error("Error loading Woka data:", err);
            error = $LL.woka.selectWoka.loadError();
        } finally {
            isLoading = false;
        }
        await tick();
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

    // Opens on the WOKA you have, or the first one
    function loadSavedTexture() {
        const list = wokaData?.woka?.collections ?? [];
        const saved = findTexture(list, gameManager.getCharacterTextureIds()?.[0]);
        collectionIndex = saved?.collectionIndex ?? 0;
        selectedId = saved?.texture.id ?? list[0]?.textures[0]?.id ?? "";
    }

    function select(id: string) {
        selectedId = id;
        document.getElementById(`woka-${id}`)?.scrollIntoView({ block: "nearest" });
    }

    // Randomize picks from every collection and shows the one it landed in
    async function randomize() {
        const all = collections.flatMap((collection, index) => collection.textures.map((t) => ({ index, t })));
        if (all.length === 0) return;
        const pick = all[Math.floor(Math.random() * all.length)];
        collectionIndex = pick.index;
        await tick();
        select(pick.t.id);
    }

    function columns(): number {
        const grid = document.getElementById("woka-grid");
        if (!grid) return 1;
        return getComputedStyle(grid).gridTemplateColumns.split(" ").length;
    }

    function save() {
        if (selectedId) saveAndContinue([selectedId]);
    }

    let enterPressed = false;

    function onKeyDown(event: KeyboardEvent) {
        if (!wokaData || event.target instanceof HTMLInputElement) return;
        const index = textures.findIndex((t) => t.id === selectedId);
        let next = index;
        if (event.key === "ArrowLeft") next = Math.max(index - 1, 0);
        else if (event.key === "ArrowRight") next = Math.min(index + 1, textures.length - 1);
        else if (event.key === "ArrowUp") next = Math.max(index - columns(), 0);
        else if (event.key === "ArrowDown") next = Math.min(index + columns(), textures.length - 1);
        else if (event.key === "Enter") {
            enterPressed = true;
            return;
        } else return;
        event.preventDefault();
        if (next !== index && textures[next]) select(textures[next].id);
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
    eyebrow={$LL.woka.selectWoka.eyebrow()}
    title={$LL.woka.selectWoka.heading()}
    {selectedTextures}
    {wokaData}
    {isLoading}
    {error}
    retry={loadWokaData}
    {randomize}
    {close}
    {categories}
    bind:category={collectionIndex}
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

    <div
        slot="tiles"
        id="woka-grid"
        class="grid grid-cols-4 md:grid-cols-6 gap-2 p-1"
        role="radiogroup"
        aria-label={$LL.woka.selectWoka.heading()}
    >
        {#each textures as texture (texture.id)}
            <button
                type="button"
                role="radio"
                id="woka-{texture.id}"
                class="u-join-tile"
                aria-checked={selectedId === texture.id}
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
                {#if selectedId === texture.id}
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
            disabled={!selectedId}
            on:click={save}
        >
            {$LL.woka.selectWoka.continue()}
        </button>
    </svelte:fragment>
</WokaCard>
