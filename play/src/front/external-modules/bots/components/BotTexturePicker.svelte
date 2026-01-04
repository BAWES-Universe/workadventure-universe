<script lang="ts">
    import { onMount } from "svelte";
    import { gameManager } from "../../../Phaser/Game/GameManager";
    import { localUserStore } from "../../../Connection/LocalUserStore";
    import { ABSOLUTE_PUSHER_URL } from "../../../Enum/ComputedConst";
    import type { WokaData, WokaTexture } from "../../../Components/Woka/WokaTypes";
    import WokaImage from "../../../Components/Woka/WokaImage.svelte";

    export let selectedTextureId: string = "";
    export let onSelect: (textureId: string) => void;

    let wokaData: WokaData | null = null;
    let isLoading = true;
    let error: string | null = null;
    let assetsDirection: number = 0;
    let currentSelectedId: string = selectedTextureId;

    // Sync with prop changes
    $: if (selectedTextureId && selectedTextureId !== currentSelectedId) {
        currentSelectedId = selectedTextureId;
    }

    async function loadWokaData() {
        try {
            isLoading = true;
            error = null;

            // Get room URL - try gameManager first, fallback to window.location
            let roomUrl: string;
            if (gameManager?.currentStartedRoom?.href) {
                roomUrl = gameManager.currentStartedRoom.href;
            } else if (window.location.href) {
                roomUrl = window.location.href;
            } else {
                throw new Error("Unable to determine room URL");
            }

            const response = await fetch(`${ABSOLUTE_PUSHER_URL}woka/list?roomUrl=${encodeURIComponent(roomUrl)}`, {
                headers: {
                    Authorization: localUserStore.getAuthToken() || "",
                },
                credentials: "include",
            });

            if (!response.ok) {
                throw new Error("Failed to load Woka data");
            }

            wokaData = await response.json();

            // Select first texture by default if none selected
            if (!currentSelectedId && wokaData?.["woka"]?.collections?.[0]?.textures?.[0]) {
                const firstTexture = wokaData["woka"].collections[0].textures[0];
                currentSelectedId = firstTexture.id;
                onSelect(firstTexture.id);
            }
        } catch (err) {
            console.error("Error loading Woka data:", err);
            error = err instanceof Error ? err.message : "Failed to load Woka customization data";
        } finally {
            isLoading = false;
        }
    }

    function selectTexture(collectionIndex: number, textureId: string) {
        if (!wokaData || !wokaData["woka"] || !wokaData["woka"].collections) {
            console.error("Woka data is not loaded");
            return;
        }
        const textures = wokaData["woka"].collections[collectionIndex].textures;
        if (!textures.some((texture: WokaTexture) => texture.id === textureId)) {
            console.error(`Texture ID ${textureId} does not exist`);
            return;
        }

        currentSelectedId = textureId;
        onSelect(textureId);
    }

    function getTextureUrl(relativeUrl: string): string {
        if (relativeUrl.startsWith("http://") || relativeUrl.startsWith("https://")) {
            return relativeUrl;
        }
        return `${ABSOLUTE_PUSHER_URL}${relativeUrl}`;
    }

    onMount(() => {
        void loadWokaData();
    });
</script>

<div class="bot-texture-picker">
    {#if isLoading}
        <div class="flex items-center justify-center py-8">
            <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
        </div>
    {:else if error}
        <div class="text-center text-red-400 py-4">
            <p class="mb-2">{error}</p>
            <button
                class="px-4 py-2 bg-red-500/20 text-red-300 rounded hover:bg-red-500/30 transition-colors"
                on:click={loadWokaData}
            >
                Retry
            </button>
        </div>
    {:else if wokaData?.["woka"]?.collections}
        <div class="space-y-4">
            <!-- Preview -->
            {#if currentSelectedId}
                <div class="flex items-center justify-center p-4 bg-white/5 rounded-lg border border-white/20">
                    <WokaImage
                        selectedTextures={{ woka: currentSelectedId }}
                        {wokaData}
                        {getTextureUrl}
                        canvasSize={128}
                        direction={assetsDirection}
                    />
                </div>
            {/if}

            <!-- Texture Grid -->
            <div class="max-h-[300px] overflow-y-auto">
                {#each wokaData["woka"].collections as collection, collectionIndex (collection.name)}
                    <div class="mb-4">
                        <p class="text-sm text-white/60 mb-2 font-medium">{collection.name}</p>
                        <div class="flex flex-wrap gap-2">
                            {#each collection.textures as texture (texture.id)}
                                <button
                                    class="rounded border-2 transition-all flex-shrink-0 w-16 h-16 flex items-center justify-center overflow-hidden {currentSelectedId ===
                                    texture.id
                                        ? 'border-blue-500 bg-blue-500/20'
                                        : 'border-white/20 bg-white/5 hover:border-white/40 hover:bg-white/10'}"
                                    on:click={() => selectTexture(collectionIndex, texture.id)}
                                    title={texture.name}
                                >
                                    <WokaImage
                                        selectedTextures={{ woka: texture.id }}
                                        {wokaData}
                                        {getTextureUrl}
                                        canvasSize={56}
                                        direction={assetsDirection}
                                        classList="p-0.5"
                                    />
                                </button>
                            {/each}
                        </div>
                    </div>
                {/each}
            </div>
        </div>
    {:else}
        <div class="text-center text-white/60 py-4">No textures available</div>
    {/if}
</div>

<style>
    .bot-texture-picker {
        color: white;
    }
</style>
