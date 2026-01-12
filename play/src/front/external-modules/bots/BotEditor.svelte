<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { get } from "svelte/store";
    import BotList from "./components/BotList.svelte";
    import BotDetailView from "./components/BotDetailView.svelte";
    import CreateBotModal from "./components/CreateBotModal.svelte";
    import type { BotData } from "./types";
    import {
        botEditorModeStore,
        selectedBotStore,
        botPreviewsStore,
        placingBotStore,
        upsertBot,
        removeBot,
        selectBot,
        startPlacingBot,
        cancelPlacement,
        loadBotPreviews,
        type BotEditorMode,
    } from "./stores/BotEditorStore";
    import { getBotEditorTool } from "./phaser/BotEditorTool";
    import { botApiService } from "./services/BotApiService";

    let showCreateModal = false;
    let botEditorTool = getBotEditorTool();
    let isLoading = false;
    let error: string | null = null;

    // Subscribe to stores
    let currentMode: BotEditorMode = "list";
    let selectedBot: BotData | null = null;
    let bots: BotData[] = [];
    let isPlacing = false;

    const unsubscribeMode = botEditorModeStore.subscribe((mode) => {
        currentMode = mode;
    });

    // Debounced auto-save for position/radius changes
    let saveTimeout: ReturnType<typeof setTimeout> | null = null;
    let lastSavedBotConfig: string | null = null;
    let lastSavedAIConfig: string | null = null;

    const unsubscribeSelectedBot = selectedBotStore.subscribe((bot) => {
        console.log(
            "[BotEditor] selectedBotStore subscription fired, bot:",
            bot?.id,
            "chatInstructions:",
            bot?.chatInstructions?.substring(0, 50)
        );
        const previousBot = selectedBot;
        selectedBot = bot || null;

        // Initialize lastSaved values when bot first selected or changes
        if (bot && (!previousBot || previousBot.id !== bot.id)) {
            console.log("[BotEditor] Bot changed or first selected, initializing lastSaved values");
            lastSavedBotConfig = JSON.stringify(bot.behaviorConfig);
            lastSavedAIConfig = JSON.stringify({
                aiProviderRef: bot.aiProviderRef,
                chatInstructions: bot.chatInstructions,
                movementInstructions: bot.movementInstructions,
            });
            console.log("[BotEditor] Initialized lastSavedAIConfig:", lastSavedAIConfig.substring(0, 100));
            // Don't return - continue to check for changes
        }

        // Auto-save when bot's config changes (position, radius, etc.) - debounced
        if (bot && botApiService.isInitialized()) {
            const currentConfig = JSON.stringify(bot.behaviorConfig);
            const currentAIConfig = JSON.stringify({
                aiProviderRef: bot.aiProviderRef,
                chatInstructions: bot.chatInstructions,
                movementInstructions: bot.movementInstructions,
            });

            console.log("[BotEditor] Comparing AI configs:", {
                current: currentAIConfig.substring(0, 100),
                lastSaved: lastSavedAIConfig?.substring(0, 100),
                areEqual: currentAIConfig === lastSavedAIConfig,
            });

            // Only save if config actually changed
            if (currentConfig !== lastSavedBotConfig) {
                // Clear any pending save
                if (saveTimeout) {
                    clearTimeout(saveTimeout);
                }

                // Debounce saves (wait 1 second after last change)
                saveTimeout = setTimeout(() => {
                    void (async () => {
                        try {
                            await botApiService.updateBot(bot.id, {
                                behaviorConfig: bot.behaviorConfig,
                            });
                            lastSavedBotConfig = currentConfig;
                        } catch (e) {
                            console.error("[BotEditor] Failed to auto-save bot:", e);

                            // Check if it's an authentication error - show error for auth issues
                            const isAuthError = (e as Error & { isAuthError?: boolean })?.isAuthError === true;
                            if (isAuthError) {
                                error = (e as Error).message;
                                // Clear error after 5 seconds
                                setTimeout(() => {
                                    error = null;
                                }, 5000);
                            }
                            // For other errors, just log (don't show for auto-saves)
                        }
                    })();
                }, 1000);
            }

            // Auto-save when AI config changes (provider, instructions) - debounced
            if (currentAIConfig !== lastSavedAIConfig) {
                console.log("[BotEditor] AI config changed, triggering auto-save:", {
                    chatInstructions: bot.chatInstructions?.substring(0, 50),
                    aiProviderRef: bot.aiProviderRef,
                });
                // Clear any pending save
                if (saveTimeout) {
                    clearTimeout(saveTimeout);
                }

                // Debounce saves (wait 1 second after last change)
                saveTimeout = setTimeout(() => {
                    void (async () => {
                        try {
                            console.log("[BotEditor] Sending AI config update to API:", {
                                botId: bot.id,
                                chatInstructions: bot.chatInstructions?.substring(0, 50),
                            });
                            await botApiService.updateBot(bot.id, {
                                aiProviderRef: bot.aiProviderRef,
                                chatInstructions: bot.chatInstructions,
                                movementInstructions: bot.movementInstructions,
                            });
                            console.log("[BotEditor] AI config update successful");
                            lastSavedAIConfig = currentAIConfig;
                        } catch (e) {
                            console.error("[BotEditor] Failed to auto-save bot AI config:", e);

                            // Check if it's an authentication error - show error for auth issues
                            const isAuthError = (e as Error & { isAuthError?: boolean })?.isAuthError === true;
                            if (isAuthError) {
                                error = (e as Error).message;
                                // Clear error after 5 seconds
                                setTimeout(() => {
                                    error = null;
                                }, 5000);
                            }
                            // For other errors, just log (don't show for auto-saves)
                        }
                    })();
                }, 1000);
            }
        } else {
            // Reset when no bot selected
            lastSavedBotConfig = null;
            lastSavedAIConfig = null;
        }
    });

    const unsubscribeBots = botPreviewsStore.subscribe((botsMap) => {
        // Convert Map to array and deduplicate by id to prevent any duplicates
        const botsArray = Array.from(botsMap.values());

        // Check for duplicates in the Map (shouldn't happen, but debug)
        if (process.env.NODE_ENV === "development" || process.env.ENABLE_BOT_DEBUG === "true") {
            const idCounts = new Map<string, number>();
            for (const bot of botsArray) {
                idCounts.set(bot.id, (idCounts.get(bot.id) || 0) + 1);
            }
            for (const [id, count] of idCounts.entries()) {
                if (count > 1) {
                    console.warn(`[BotEditor] Duplicate bot ID detected in Map: ${id} (${count} times)`);
                }
            }
        }

        // Deduplicate by id (shouldn't be necessary since Map keys are unique, but safety check)
        const uniqueBots = new Map<string, BotData>();
        for (const bot of botsArray) {
            if (bot.id) {
                // Always use the latest bot if there are duplicates (last one wins)
                uniqueBots.set(bot.id, bot);
            }
        }
        bots = Array.from(uniqueBots.values());
    });

    let previousPlacingBot: BotData | undefined = undefined;
    const unsubscribePlacing = placingBotStore.subscribe((bot) => {
        isPlacing = !!bot;

        // Capture the previous bot before updating
        const capturedPreviousBot = previousPlacingBot;
        previousPlacingBot = bot;

        // If placement was just completed (bot went from defined to undefined)
        if (capturedPreviousBot && !bot && botApiService.isInitialized()) {
            // Find the bot that was just placed
            const placedBot = get(selectedBotStore);
            if (placedBot && placedBot.id === capturedPreviousBot.id) {
                // Save the position to API (fire and forget)
                void (async () => {
                    try {
                        await botApiService.updateBot(placedBot.id, {
                            behaviorConfig: placedBot.behaviorConfig,
                        });
                    } catch (e) {
                        console.error("[BotEditor] Failed to save bot position after placement:", e);
                        error = e instanceof Error ? e.message : "Failed to save bot position";
                    }
                })();
            }
        }
    });

    onMount(async () => {
        // Activate the Phaser tool
        botEditorTool.activate();

        // Load bots from API
        await loadBots();
    });

    async function loadBots() {
        if (!botApiService.isInitialized()) {
            console.warn("[BotEditor] API service not initialized");
            return;
        }

        isLoading = true;
        error = null;

        // Clear bot store immediately to prevent showing old bots from previous room
        botPreviewsStore.set(new Map());
        selectedBotStore.set(undefined);

        try {
            const loadedBots = await botApiService.listBots();
            // Update store with loaded bots
            loadBotPreviews(loadedBots);
        } catch (e) {
            console.error("[BotEditor] Failed to load bots:", e);
            error = e instanceof Error ? e.message : "Failed to load bots";
        } finally {
            isLoading = false;
        }
    }

    onDestroy(() => {
        // Clear any pending saves
        if (saveTimeout) {
            clearTimeout(saveTimeout);
        }

        // Deactivate the Phaser tool
        botEditorTool.deactivate();

        // Unsubscribe from stores
        unsubscribeMode();
        unsubscribeSelectedBot();
        unsubscribeBots();
        unsubscribePlacing();
    });

    // Function to update a bot in the store
    function updateBotInStore(updatedBot: BotData) {
        upsertBot(updatedBot);
    }

    function handleSelectBot(bot: BotData | null) {
        selectBot(bot || undefined);
    }

    function handleCreateBot() {
        showCreateModal = true;
    }

    async function handleCreateBotSubmit(name: string, textureId: string) {
        if (!botApiService.isInitialized()) {
            error = "API service not initialized";
            return;
        }

        isLoading = true;
        error = null;

        try {
            // Create bot via API (will be placed after user clicks on map)
            const createdBot = await botApiService.createBot({
                roomId: "", // Will be set from service's roomId
                name,
                characterTextureId: textureId,
                enabled: true,
                behaviorType: "idle",
                behaviorConfig: {
                    behaviorType: "idle",
                    assignedSpace: {
                        center: { x: 0, y: 0 },
                        radius: 0, // Idle bots default to radius 0 (stationary)
                    },
                },
                chatInstructions: "",
                movementInstructions: "",
            });

            // Convert API response to BotData format
            const apiTextureId = typeof createdBot.characterTextureId === "string" ? createdBot.characterTextureId : "";
            const newBot: BotData = {
                id: createdBot.id,
                botId: createdBot.id,
                name: createdBot.name,
                description: typeof createdBot.description === "string" ? createdBot.description : undefined,
                characterTexture: apiTextureId,
                characterTextureIds: apiTextureId ? [apiTextureId] : [],
                behaviorType: createdBot.behaviorType as "idle" | "patrol" | "social",
                enabled: createdBot.enabled ?? true,
                behaviorConfig: createdBot.behaviorConfig || {
                    behaviorType: createdBot.behaviorType as "idle" | "patrol" | "social",
                    assignedSpace: {
                        center: { x: 0, y: 0 },
                        radius: 0,
                    },
                },
                chatInstructions: createdBot.chatInstructions || "",
                movementInstructions: createdBot.movementInstructions || "",
                createdAt: createdBot.createdAt || new Date().toISOString(),
                updatedAt: createdBot.updatedAt || new Date().toISOString(),
                createdBy: createdBot.createdBy || null,
                updatedBy: createdBot.updatedBy || null,
            };

            // Close modal
            showCreateModal = false;

            // Start placement mode - user will click on map to set position
            startPlacingBot(newBot);
        } catch (e) {
            console.error("[BotEditor] Failed to create bot:", e);
            error = e instanceof Error ? e.message : "Failed to create bot";
        } finally {
            isLoading = false;
        }
    }

    function handleCloseCreateModal() {
        showCreateModal = false;
    }

    function handleBackToList() {
        selectBot(undefined);
        botEditorModeStore.set("list");
    }

    async function handleSave() {
        if (!selectedBot || !botApiService.isInitialized()) {
            return;
        }

        isLoading = true;
        error = null;

        try {
            // Convert BotData to API format
            const updateData = {
                name: selectedBot.name,
                description: selectedBot.description,
                characterTextureId: selectedBot.characterTexture,
                enabled: selectedBot.enabled,
                behaviorType: selectedBot.behaviorType,
                behaviorConfig: selectedBot.behaviorConfig,
                aiProviderRef: selectedBot.aiProviderRef,
                chatInstructions: selectedBot.chatInstructions,
                movementInstructions: selectedBot.movementInstructions,
            };

            const updatedBot = await botApiService.updateBot(selectedBot.id, updateData);

            // Convert API response back to BotData format
            const textureId = typeof updatedBot.characterTextureId === "string" ? updatedBot.characterTextureId : "";
            const botData: BotData = {
                id: updatedBot.id,
                botId: updatedBot.id,
                name: updatedBot.name,
                description: typeof updatedBot.description === "string" ? updatedBot.description : undefined,
                characterTexture: textureId,
                characterTextureIds: textureId ? [textureId] : [],
                behaviorType: updatedBot.behaviorType as "idle" | "patrol" | "social",
                enabled: updatedBot.enabled ?? true,
                behaviorConfig: updatedBot.behaviorConfig || {
                    behaviorType: updatedBot.behaviorType as "idle" | "patrol" | "social",
                    assignedSpace: { center: { x: 0, y: 0 }, radius: 0 },
                },
                aiProviderRef: updatedBot.aiProviderRef,
                chatInstructions: updatedBot.chatInstructions || "",
                movementInstructions: updatedBot.movementInstructions || "",
                createdAt: updatedBot.createdAt || new Date().toISOString(),
                updatedAt: updatedBot.updatedAt || new Date().toISOString(),
                createdBy: updatedBot.createdBy || null,
                updatedBy: updatedBot.updatedBy || null,
            };

            // Update store
            updateBotInStore(botData);
        } catch (e) {
            console.error("[BotEditor] Failed to save bot:", e);

            // Check if it's an authentication error
            const isAuthError = (e as Error & { isAuthError?: boolean })?.isAuthError === true;
            if (isAuthError) {
                error = (e as Error).message;
            } else {
                error = e instanceof Error ? e.message : "Failed to save bot";
            }
        } finally {
            isLoading = false;
        }
    }

    async function handleDelete() {
        if (!selectedBot?.id || !botApiService.isInitialized()) {
            return;
        }

        if (!confirm(`Are you sure you want to delete "${selectedBot.name}"?`)) {
            return;
        }

        isLoading = true;
        error = null;

        try {
            // Despawn the bot first (so it disappears immediately)
            const despawnResult = await botApiService.despawnBot(selectedBot.id);
            console.log("[BotEditor] Despawn result:", despawnResult);

            // Then delete from Admin API
            await botApiService.deleteBot(selectedBot.id);

            // Remove from store
            removeBot(selectedBot.id);
            // After delete, return to list
            handleBackToList();
        } catch (e) {
            console.error("[BotEditor] Failed to delete bot:", e);

            // Check if it's an authentication error
            const isAuthError = (e as Error & { isAuthError?: boolean })?.isAuthError === true;
            if (isAuthError) {
                error = (e as Error).message;
            } else {
                error = e instanceof Error ? e.message : "Failed to delete bot";
            }
        } finally {
            isLoading = false;
        }
    }

    function handleCancelPlacement() {
        cancelPlacement();
    }

    function handleLocateBot(botId: string) {
        botEditorTool.panToBot(botId);
    }
</script>

<div class="bot-editor flex flex-col h-full min-h-0" style="padding-top: 30px;">
    {#if error}
        <div class="bg-red-500/20 border border-red-500/50 rounded-lg p-4 m-4">
            <p class="text-red-200 text-sm">{error}</p>
            <button
                class="mt-2 px-3 py-1 bg-red-500/20 text-red-200 rounded hover:bg-red-500/30 text-xs"
                on:click={loadBots}
            >
                Retry
            </button>
        </div>
    {/if}

    {#if isLoading && bots.length === 0}
        <div class="flex items-center justify-center h-full">
            <div class="text-center">
                <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto mb-2" />
                <p class="text-white/70 text-sm">Loading bots...</p>
            </div>
        </div>
    {:else if isPlacing}
        <!-- Placement Mode UI -->
        <div class="placement-mode p-4 text-center">
            <div class="bg-blue-500/20 border border-blue-500/50 rounded-lg p-4 mb-4">
                <svg class="w-12 h-12 mx-auto mb-2 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                    />
                    <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                </svg>
                <h3 class="text-lg font-semibold text-white mb-2">Place Your Bot</h3>
                <p class="text-sm text-white/70 mb-4">Click on the map to place the bot at your desired location.</p>
                <p class="text-xs text-white/50">
                    Hold <kbd class="px-1 py-0.5 bg-white/10 rounded">Shift</kbd> to snap to grid
                </p>
            </div>
            <button
                class="px-4 py-2 bg-white/10 text-white rounded hover:bg-white/20 transition-colors"
                on:click={handleCancelPlacement}
            >
                Cancel Placement
            </button>
        </div>
    {:else if currentMode === "list" || currentMode === "placing"}
        <BotList {bots} onSelectBot={handleSelectBot} onCreateBot={handleCreateBot} onLocateBot={handleLocateBot} />
    {:else if currentMode === "detail" || currentMode === "waypoint-edit"}
        <BotDetailView
            bot={selectedBot}
            onBack={handleBackToList}
            onSave={handleSave}
            onDelete={handleDelete}
            onLocate={() => selectedBot && handleLocateBot(selectedBot.id)}
        />
    {/if}

    <CreateBotModal isOpen={showCreateModal} onClose={handleCloseCreateModal} onCreate={handleCreateBotSubmit} />
</div>

<style>
    .bot-editor {
        color: white;
    }

    kbd {
        font-family: monospace;
    }
</style>
