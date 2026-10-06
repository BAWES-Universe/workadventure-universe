<script lang="ts">
    import { onDestroy, onMount, tick } from "svelte";
    import { LL } from "../../../i18n/i18n-svelte";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { joinDesktopStore } from "../../Stores/JoinDesktopStore";
    import HatOutlineIcon from "../Join/HatOutlineIcon.svelte";
    import type { WokaBodyPart, WokaData } from "./WokaTypes";
    import WokaImage from "./WokaImage.svelte";
    import WokaCard from "./WokaCard.svelte";
    import { fetchWokaData, getWokaTextureUrl, texturesByPart } from "./WokaData";
    import { IconCheck, IconEye, IconEyeglass, IconLayoutGrid, IconPalette, IconScissors, IconShirt } from "@wa-icons";

    export let back: () => void;
    export let saveAndContinue: (texturesId: string[]) => void;
    export let close: (() => void) | undefined = undefined;

    const bodyPartOrder: WokaBodyPart[] = ["body", "eyes", "hair", "clothes", "hat", "accessory"];
    const partIcons = [IconPalette, IconEye, IconScissors, IconShirt, HatOutlineIcon, IconEyeglass];

    let wokaData: WokaData | null = null;
    let partIndex = 0;
    let selectedTextures: Record<string, string> = {};
    let isLoading = true;
    let error = "";
    let direction = 0;

    $: tileSize = $joinDesktopStore ? 64 : 52;

    $: part = bodyPartOrder[partIndex];
    $: categories = bodyPartOrder.map((p, index) => ({
        label: $LL.woka.customWoka.parts[p](),
        icon: partIcons[index],
    }));
    // Every option of the part, across its collections
    $: options = (wokaData?.[part]?.collections ?? []).flatMap((collection) => collection.textures);

    async function loadWokaData() {
        isLoading = true;
        error = "";
        try {
            wokaData = await fetchWokaData();
            loadSavedTextures(wokaData);
        } catch (err) {
            console.error("Error loading Woka data:", err);
            error = $LL.woka.selectWoka.loadError();
        } finally {
            isLoading = false;
        }
        await tick();
        scrollToSelected();
    }

    // Opens on the parts you have; a WOKA picked whole starts from the first option of each part
    function loadSavedTextures(data: WokaData) {
        const saved = texturesByPart(gameManager.getCharacterTextureIds(), data);
        const next: Record<string, string> = {};
        for (const p of bodyPartOrder) {
            const id = saved[p] ?? data[p]?.collections?.[0]?.textures?.[0]?.id;
            if (id) next[p] = id;
        }
        selectedTextures = next;
    }

    function scrollToSelected() {
        document.getElementById(`texture-${part}-${selectedTextures[part]}`)?.scrollIntoView({ block: "nearest" });
    }

    function select(id: string) {
        selectedTextures = { ...selectedTextures, [part]: id };
        document.getElementById(`texture-${part}-${id}`)?.scrollIntoView({ block: "nearest" });
    }

    // Randomize picks every part from all of its collections
    async function randomize() {
        const next = { ...selectedTextures };
        for (const p of bodyPartOrder) {
            const all = (wokaData?.[p]?.collections ?? []).flatMap((collection) => collection.textures);
            if (all.length > 0) next[p] = all[Math.floor(Math.random() * all.length)].id;
        }
        selectedTextures = next;
        await tick();
        scrollToSelected();
    }

    async function nextPart() {
        await card?.selectCategory(partIndex + 1);
        scrollToSelected();
    }

    function finish() {
        saveAndContinue(bodyPartOrder.map((p) => selectedTextures[p]).filter(Boolean));
    }

    let card: WokaCard | undefined;

    function columns(): number {
        const grid = document.getElementById("woka-grid");
        if (!grid) return 1;
        return getComputedStyle(grid).gridTemplateColumns.split(" ").length;
    }

    let enterPressed = false;

    function onKeyDown(event: KeyboardEvent) {
        if (!wokaData || event.target instanceof HTMLInputElement) return;
        const index = options.findIndex((t) => t.id === selectedTextures[part]);
        let next = index;
        if (event.key === "ArrowLeft") next = Math.max(index - 1, 0);
        else if (event.key === "ArrowRight") next = Math.min(index + 1, options.length - 1);
        else if (event.key === "ArrowUp") next = Math.max(index - columns(), 0);
        else if (event.key === "ArrowDown") next = Math.min(index + columns(), options.length - 1);
        else if (event.key === "Enter") {
            // A focused button (Randomize, Build, Save…) does its own job on Enter; tiles let Enter save
            if (event.target instanceof HTMLButtonElement && event.target.getAttribute("role") !== "radio") return;
            enterPressed = true;
            return;
        } else return;
        event.preventDefault();
        if (next !== index && options[next]) select(options[next].id);
    }

    function onKeyUp(event: KeyboardEvent) {
        // On key up, so the Enter that saves does not reach the next screen. Enter moves to the next part and
        // saves on the last one.
        if (event.key === "Enter" && enterPressed) {
            enterPressed = false;
            if (partIndex === bodyPartOrder.length - 1) finish();
            else nextPart().catch((e) => console.error(e));
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
    eyebrow={$LL.woka.customWoka.eyebrow()}
    title={$LL.woka.customWoka.heading()}
    {selectedTextures}
    {wokaData}
    {isLoading}
    {error}
    retry={loadWokaData}
    {randomize}
    {close}
    {categories}
    bind:category={partIndex}
    swipeHint={$LL.woka.customWoka.swipeHint()}
    bind:direction
>
    <svelte:fragment slot="hint">
        {$LL.woka.customWoka.part({ current: partIndex + 1, total: bodyPartOrder.length })} ·
        <span class="u-join-kbd">Enter</span>
        {$LL.woka.customWoka.nextPart()}
    </svelte:fragment>

    <div
        slot="tiles"
        id="woka-grid"
        class="grid grid-cols-4 md:grid-cols-6 gap-2 p-1"
        role="radiogroup"
        aria-label={categories[partIndex]?.label}
    >
        {#each options as texture (texture.id)}
            <button
                type="button"
                role="radio"
                id="texture-{part}-{texture.id}"
                class="u-join-tile"
                aria-checked={selectedTextures[part] === texture.id}
                aria-label={texture.name}
                on:click={() => select(texture.id)}
            >
                <!-- Each option on your own WOKA -->
                <WokaImage
                    selectedTextures={{ ...selectedTextures, [part]: texture.id }}
                    {wokaData}
                    getTextureUrl={getWokaTextureUrl}
                    canvasSize={tileSize}
                    {direction}
                />
                {#if selectedTextures[part] === texture.id}
                    <span class="u-join-tile-check"><IconCheck font-size="12" /></span>
                {/if}
            </button>
        {/each}
    </div>

    <svelte:fragment slot="footer">
        <!-- Build and the ready-made WOKAs are two modes: this switches mode, it isn't a step back -->
        <button type="button" class="u-join-btn u-cta-secondary wokaBuildBack !px-3 md:!px-5" on:click={back}>
            <IconLayoutGrid font-size="16" />
            <span class="md:hidden">{$LL.woka.customWoka.presetsShort()}</span>
            <span class="hidden md:inline">{$LL.woka.customWoka.presets()}</span>
        </button>
        <button
            type="button"
            class="u-join-btn u-cta md:min-w-[180px] selectCharacterSceneFormSubmit"
            on:click={finish}
        >
            {$LL.woka.customWoka.navigation.finish()}
        </button>
    </svelte:fragment>
</WokaCard>
