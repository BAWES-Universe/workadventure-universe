<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { roomChangeTriggerStore } from "../stores/BotEditorStore";
    import { gameManager } from "../../../Phaser/Game/GameManager";
    import { localUserStore } from "../../../Connection/LocalUserStore";
    import { ABSOLUTE_PUSHER_URL } from "../../../Enum/ComputedConst";
    import type { WokaData, WokaTexture, WokaCollection } from "../../../Components/Woka/WokaTypes";
    import WokaImage from "../../../Components/Woka/WokaImage.svelte";

    export let selectedTextureId: string = "";
    export let onSelect: (textureId: string) => void;
    export let botId: string = "";

    let wokaData: WokaData | null = null;
    let isLoading = true;
    let error: string | null = null;
    let assetsDirection: number = 0;
    let currentSelectedId: string = selectedTextureId;
    let loadRequestId = 0;
    let roomChangeUnsubscribe: () => void;

    // Sync with prop changes
    $: if (selectedTextureId && selectedTextureId !== currentSelectedId) {
        currentSelectedId = selectedTextureId;
    }

    async function loadWokaData() {
        const requestId = ++loadRequestId;
        try {
            isLoading = true;
            error = null;

            // Get room URL - try current game scene first (updates on portal teleport),
            // fallback to start room (initial entry), then window.location
            let roomUrl: string;
            if (gameManager) {
                let scene;
                try {
                    scene = gameManager.getCurrentGameScene();
                } catch {
                    // Game scene not available yet — fall through to fallback URLs
                }
                if (scene?.room?.href) {
                    roomUrl = scene.room.href;
                } else if (gameManager.currentStartedRoom?.href) {
                    roomUrl = gameManager.currentStartedRoom.href;
                } else {
                    roomUrl = window.location.href;
                }
            } else {
                roomUrl = window.location.href;
            }

            let url = `${ABSOLUTE_PUSHER_URL}woka/list?roomUrl=${encodeURIComponent(roomUrl)}&context=bot`;
            if (botId) {
                url += `&botId=${encodeURIComponent(botId)}`;
            }

            const response = await fetch(url, {
                headers: {
                    Authorization: localUserStore.getAuthToken() || "",
                },
                credentials: "include",
            });

            if (!response.ok) {
                throw new Error("Failed to load Woka data");
            }

            const data: WokaData = await response.json();

            // Discard stale response from a previous (rapid) room change
            if (requestId !== loadRequestId) return;

            wokaData = data;

            // Validate currentSelectedId against the new catalog.
            // If the previously selected texture no longer exists (room changed),
            // fall back to the first available texture.
            if (currentSelectedId) {
                const exists = data["woka"]?.collections?.some((col: WokaCollection) =>
                    col.textures?.some((t: WokaTexture) => t.id === currentSelectedId)
                );
                if (!exists) {
                    const firstTexture = data["woka"]?.collections?.[0]?.textures?.[0];
                    if (firstTexture) {
                        currentSelectedId = firstTexture.id;
                        onSelect(firstTexture.id);
                    } else {
                        currentSelectedId = "";
                        onSelect("");
                    }
                }
            } else if (data["woka"]?.collections?.[0]?.textures?.[0]) {
                // Select first texture by default if none selected
                const firstTexture = data["woka"].collections[0].textures[0];
                currentSelectedId = firstTexture.id;
                onSelect(firstTexture.id);
            }
        } catch (err) {
            if (requestId !== loadRequestId) return;
            console.error("Error loading Woka data:", err);
            error = err instanceof Error ? err.message : "Failed to load Woka customization data";
        } finally {
            if (requestId === loadRequestId) {
                isLoading = false;
            }
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

        // Re-fetch when room changes (e.g. teleported between worlds)
        let isFirstEmission = true;
        roomChangeUnsubscribe = roomChangeTriggerStore.subscribe(() => {
            if (isFirstEmission) {
                isFirstEmission = false;
                return;
            }
            void loadWokaData();
        });
    });

    onDestroy(() => {
        if (roomChangeUnsubscribe) {
            roomChangeUnsubscribe();
        }
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
