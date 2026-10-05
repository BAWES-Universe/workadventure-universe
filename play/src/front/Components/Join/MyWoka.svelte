<script lang="ts">
    import { onMount } from "svelte";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import WokaImage from "../Woka/WokaImage.svelte";
    import { fetchWokaData, getWokaTextureUrl, texturesByPart } from "../Woka/WokaData";
    import type { WokaData } from "../Woka/WokaTypes";

    /** Your own WOKA, walking on the spot, for the name and camera screens. Shows nothing if the catalog fails. */
    export let size = 64;
    export let walking = true;

    let wokaData: WokaData | null = null;
    let selectedTextures: Record<string, string> = {};

    onMount(() => {
        fetchWokaData()
            .then((data) => {
                wokaData = data;
                selectedTextures = texturesByPart(gameManager.getCharacterTextureIds(), data);
            })
            .catch((e) => console.warn("Could not load the WOKA catalog for the preview", e));
    });
</script>

{#if wokaData}
    <WokaImage {selectedTextures} {wokaData} canvasSize={size} getTextureUrl={getWokaTextureUrl} {walking} />
{:else}
    <span class="block" style="width: {size}px; height: {size}px;" />
{/if}
