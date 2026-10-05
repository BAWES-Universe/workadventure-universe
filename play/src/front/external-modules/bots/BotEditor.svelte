<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { get } from "svelte/store";
    import LL from "../../../i18n/i18n-svelte";
    import { editPanelBackStore, editPlacingBarStore } from "../../Stores/EditModeStore";
    import { mapEditorVisibilityStore } from "../../Stores/MapEditorStore";
    import { mobileLayoutStore } from "../../Stores/MobileLayoutStore";
    import BotList from "./components/BotList.svelte";
    import BotDetailView from "./components/BotDetailView.svelte";
    import NewBotView from "./components/NewBotView.svelte";
    import type { BotData } from "./types";
    import {
        botEditorModeStore,
        selectedBotStore,
        botPreviewsStore,
        botsLoadedForRoomIdStore,
        placingBotStore,
        roomChangeTriggerStore,
        upsertBot,
        removeBot,
        selectBot,
        startPlacingBot,
        cancelPlacement,
        loadBotPreviews,
        queueBotSave,
        routeUndoCountStore,
        stopWaypointEditing,
        undoRouteChange,
        type BotEditorMode,
    } from "./stores/BotEditorStore";
    import { routeStops } from "./behaviorModel";
    import { getBotEditorTool } from "./phaser/BotEditorTool";
    import { botApiService } from "./services/BotApiService";
    import { IconArrowBackUp, IconRoute } from "@wa-icons";

    let detailView: BotDetailView | undefined;
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

    // Debounced auto-save. Behavior config (position, radius...) and AI config are saved separately, so a change to one
    // doesn't cancel the other's pending save
    type SaveKind = "config" | "ai";
    const pendingSaves = new Map<SaveKind, { timeout: ReturnType<typeof setTimeout>; save: () => void }>();
    let lastSavedBotConfig: string | null = null;
    let lastSavedAIConfig: string | null = null;

    /** What the "ai" save sends besides the behavior: the bot's mind, chat instructions, Patience and description */
    function aiConfigOf(bot: BotData): string {
        return JSON.stringify({
            aiProviderRef: bot.aiProviderRef,
            chatInstructions: bot.chatInstructions,
            toolTimeoutSeconds: bot.toolTimeoutSeconds ?? null,
            description: bot.description ?? "",
        });
    }

    /** Debounce a save (wait 1 second after the last change), replacing the pending save of the same kind */
    function scheduleSave(kind: SaveKind, save: () => void): void {
        const pending = pendingSaves.get(kind);
        if (pending) {
            clearTimeout(pending.timeout);
        }
        const timeout = setTimeout(() => {
            pendingSaves.delete(kind);
            save();
        }, 1000);
        pendingSaves.set(kind, { timeout, save });
    }

    const unsubscribeSelectedBot = selectedBotStore.subscribe((bot) => {
        if (process.env.NODE_ENV === "development" || process.env.ENABLE_BOT_DEBUG === "true") {
            console.log(
                "[BotEditor] selectedBotStore subscription fired, bot:",
                bot?.id,
                "chatInstructions:",
                bot?.chatInstructions?.substring(0, 50)
            );
        }
        const previousBot = selectedBot;
        selectedBot = bot || null;

        // Initialize lastSaved values when bot first selected or changes
        if (bot && (!previousBot || previousBot.id !== bot.id)) {
            if (process.env.NODE_ENV === "development" || process.env.ENABLE_BOT_DEBUG === "true") {
                console.log("[BotEditor] Bot changed or first selected, initializing lastSaved values");
            }
            lastSavedBotConfig = JSON.stringify(bot.behaviorConfig);
            lastSavedAIConfig = aiConfigOf(bot);
            if (process.env.NODE_ENV === "development" || process.env.ENABLE_BOT_DEBUG === "true") {
                console.log("[BotEditor] Initialized lastSavedAIConfig:", lastSavedAIConfig.substring(0, 100));
            }
        }

        // Check if only name changed (name changes are handled separately in BotDetailView)
        const isOnlyNameChange =
            bot &&
            previousBot &&
            previousBot.id === bot.id &&
            previousBot.name !== bot.name &&
            JSON.stringify(previousBot.behaviorConfig) === JSON.stringify(bot.behaviorConfig) &&
            aiConfigOf(previousBot) === aiConfigOf(bot);

        // Auto-save when bot's config changes (position, radius, etc.) - debounced
        // Skip if only name changed (handled separately)
        if (bot && botApiService.isInitialized() && !isOnlyNameChange) {
            const currentConfig = JSON.stringify(bot.behaviorConfig);
            const currentAIConfig = aiConfigOf(bot);

            if (process.env.NODE_ENV === "development" || process.env.ENABLE_BOT_DEBUG === "true") {
                console.log("[BotEditor] Comparing AI configs:", {
                    current: currentAIConfig.substring(0, 100),
                    lastSaved: lastSavedAIConfig?.substring(0, 100),
                    areEqual: currentAIConfig === lastSavedAIConfig,
                });
            }

            // Only save if config actually changed
            if (currentConfig !== lastSavedBotConfig) {
                scheduleSave("config", () => {
                    void (async () => {
                        try {
                            // Extract behaviorType from behaviorConfig if present, or use top-level
                            const behaviorType = bot.behaviorType || bot.behaviorConfig?.behaviorType || "idle";

                            await queueBotSave(bot.id, () =>
                                botApiService.updateBot(bot.id, {
                                    behaviorType, // Include behaviorType explicitly to ensure it's saved
                                    behaviorConfig: bot.behaviorConfig,
                                })
                            );
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
                });
            }

            // Auto-save when AI config changes (provider, instructions) - debounced
            if (currentAIConfig !== lastSavedAIConfig) {
                if (process.env.NODE_ENV === "development" || process.env.ENABLE_BOT_DEBUG === "true") {
                    console.log("[BotEditor] AI config changed, triggering auto-save:", {
                        chatInstructions: bot.chatInstructions?.substring(0, 50),
                        aiProviderRef: bot.aiProviderRef,
                    });
                }
                scheduleSave("ai", () => {
                    void (async () => {
                        try {
                            if (process.env.NODE_ENV === "development" || process.env.ENABLE_BOT_DEBUG === "true") {
                                console.log("[BotEditor] Sending AI config update to API:", {
                                    botId: bot.id,
                                    chatInstructions: bot.chatInstructions?.substring(0, 50),
                                });
                            }
                            // Include behaviorType to ensure it's saved when AI config changes. The save is queued
                            // behind this bot's other saves, and reads the type when it runs rather than from this
                            // snapshot: the behavior may have been switched in the meantime, and a stale type would
                            // switch it back.
                            await queueBotSave(bot.id, () => {
                                const currentBot = get(botPreviewsStore).get(bot.id) ?? bot;
                                const behaviorType =
                                    currentBot.behaviorType || currentBot.behaviorConfig?.behaviorType || "idle";
                                return botApiService.updateBot(bot.id, {
                                    behaviorType, // Include behaviorType explicitly to ensure it's saved
                                    aiProviderRef: bot.aiProviderRef,
                                    chatInstructions: bot.chatInstructions,
                                    toolTimeoutSeconds: bot.toolTimeoutSeconds ?? null,
                                    description: bot.description ?? "",
                                });
                            });
                            if (process.env.NODE_ENV === "development" || process.env.ENABLE_BOT_DEBUG === "true") {
                                console.log("[BotEditor] AI config update successful");
                            }
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
                });
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

    // Subscribe to room changes and reload bots when room changes
    let roomChangeUnsubscribe: (() => void) | null = null;
    // Svelte doesn't cancel onMount's continuation when the component is destroyed mid-load
    let destroyed = false;

    onMount(async () => {
        // Activate the Phaser tool first
        botEditorTool.activate();

        // Load bots from API (tool will create previews via store subscription).
        // Reopening the editor in the same room keeps the current list on screen while it refreshes.
        const loadedRoomId = get(botsLoadedForRoomIdStore);
        await loadBots({ keepCurrent: loadedRoomId !== null && loadedRoomId === botApiService.getRoomId() });

        // The editor was closed while loading: don't reactivate the tool or leave a subscription nothing removes
        if (destroyed) {
            return;
        }

        // Ensure tool is still active after loading (in case scene wasn't ready initially)
        if (!botEditorTool.getIsActive()) {
            botEditorTool.activate();
        }

        // Subscribe to room changes - reload bots when room changes
        // Skip the first emission (initial value) - we already loaded bots above
        let isFirstEmission = true;
        roomChangeUnsubscribe = roomChangeTriggerStore.subscribe((triggerValue) => {
            if (isFirstEmission) {
                isFirstEmission = false;
                return; // Skip initial value
            }
            // Room changed - reload bots for the new room
            if (process.env.NODE_ENV === "development" || process.env.ENABLE_BOT_DEBUG === "true") {
                console.log(`[BotEditor] Room change detected (trigger: ${triggerValue}), reloading bots...`);
            }
            void loadBots();
        });
    });

    async function loadBots({ keepCurrent = false }: { keepCurrent?: boolean } = {}) {
        if (!botApiService.isInitialized()) {
            console.warn("[BotEditor] API service not initialized");
            return;
        }

        isLoading = true;
        error = null;

        if (!keepCurrent) {
            // Clear bot store immediately to prevent showing old bots from previous room
            botPreviewsStore.set(new Map());
            botsLoadedForRoomIdStore.set(null);
        }
        selectedBotStore.set(undefined);
        // Reset mode to list when (re)loading bots (e.g., when navigating to different map)
        botEditorModeStore.set("list");

        const roomId = botApiService.getRoomId();
        try {
            const loadedBots = await botApiService.listBots();
            // Update store with loaded bots
            loadBotPreviews(loadedBots);
            botsLoadedForRoomIdStore.set(roomId);
        } catch (e) {
            console.error("[BotEditor] Failed to load bots:", e);
            error = e instanceof Error ? e.message : "Failed to load bots";
            // The list shown may be stale now, so the next open reloads it from scratch
            botsLoadedForRoomIdStore.set(null);
        } finally {
            isLoading = false;
        }
    }

    onDestroy(() => {
        destroyed = true;

        // Unsubscribe from room changes
        if (roomChangeUnsubscribe) {
            roomChangeUnsubscribe();
            roomChangeUnsubscribe = null;
        }

        // Run pending saves now rather than dropping them: closing the editor right after an edit lost it. The
        // detail view's own debounced edits go first, while this component still listens for them (a parent's
        // onDestroy runs before its children's).
        detailView?.flushPendingSaves();
        for (const { timeout, save } of pendingSaves.values()) {
            clearTimeout(timeout);
            save();
        }
        pendingSaves.clear();

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
        botEditorModeStore.set("create");
    }

    async function handleCreateBotSubmit(name: string, textureId: string) {
        if (!botApiService.isInitialized()) {
            error = "API service not initialized";
            return;
        }

        isLoading = true;
        error = null;

        try {
            // Get first available AI provider to auto-select
            let aiProviderRef: string | undefined = undefined;
            try {
                const providers = await botApiService.getAvailableAIProviders(true);
                if (providers.length > 0) {
                    // Select first available provider (prefer enabled, but allow disabled if that's all we have)
                    const enabledProvider = providers.find((p) => p.enabled);
                    aiProviderRef = enabledProvider?.providerId || providers[0].providerId;
                }
            } catch (e) {
                console.warn("[BotEditor] Failed to load AI providers for auto-selection:", e);
                // Continue without provider - user can set it later
            }

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
                aiProviderRef,
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
                aiProviderRef: createdBot.aiProviderRef || aiProviderRef,
                chatInstructions: createdBot.chatInstructions || "",
                createdAt: createdBot.createdAt || new Date().toISOString(),
                updatedAt: createdBot.updatedAt || new Date().toISOString(),
                createdBy: createdBot.createdBy || null,
                updatedBy: createdBot.updatedBy || null,
            };

            // Close modal

            // Start placement mode - user will click on map to set position
            startPlacingBot(newBot);
        } catch (e) {
            console.error("[BotEditor] Failed to create bot:", e);
            error = e instanceof Error ? e.message : "Failed to create bot";
        } finally {
            isLoading = false;
        }
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
            // Ensure behaviorType is never undefined - check both top-level and behaviorConfig
            const behaviorType = selectedBot.behaviorType || selectedBot.behaviorConfig?.behaviorType || "idle";

            const updateData = {
                name: selectedBot.name,
                description: selectedBot.description,
                characterTextureId: selectedBot.characterTexture,
                enabled: selectedBot.enabled,
                behaviorType, // Guaranteed to be set
                behaviorConfig: selectedBot.behaviorConfig,
                aiProviderRef: selectedBot.aiProviderRef,
                chatInstructions: selectedBot.chatInstructions,
            };

            const botId = selectedBot.id;
            const updatedBot = await queueBotSave(botId, () => botApiService.updateBot(botId, updateData));

            // Convert API response back to BotData format
            const textureId = typeof updatedBot.characterTextureId === "string" ? updatedBot.characterTextureId : "";
            // Ensure behaviorType is never undefined
            const behaviorConfig = updatedBot.behaviorConfig as BotData["behaviorConfig"] | undefined;
            const responseBehaviorType =
                (updatedBot.behaviorType as "idle" | "patrol" | "social") || behaviorConfig?.behaviorType || "idle";

            const botData: BotData = {
                id: updatedBot.id,
                botId: updatedBot.id,
                name: updatedBot.name,
                description: typeof updatedBot.description === "string" ? updatedBot.description : undefined,
                characterTexture: textureId,
                characterTextureIds: textureId ? [textureId] : [],
                behaviorType: responseBehaviorType, // Guaranteed to be set
                enabled: updatedBot.enabled ?? true,
                behaviorConfig: updatedBot.behaviorConfig || {
                    behaviorType: responseBehaviorType,
                    assignedSpace: { center: { x: 0, y: 0 }, radius: 0 },
                },
                aiProviderRef: updatedBot.aiProviderRef,
                chatInstructions: updatedBot.chatInstructions || "",
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

    // The bot page's back circle sits in the panel's title, next to "Bots"
    function backToList() {
        // Flush while the bot is still selected: only changes to the selected bot are saved
        detailView?.flushPendingSaves();
        handleBackToList();
    }
    $: editPanelBackStore.set(
        (currentMode === "detail" || currentMode === "waypoint-edit") && selectedBot
            ? { onBack: backToList, label: $LL.mapEditor.edit.bots.page.back() }
            : currentMode === "create"
            ? { onBack: handleBackToList, label: $LL.mapEditor.edit.bots.page.back() }
            : undefined
    );

    // Editing a route: the bar at the bottom says whose route it is and how many stops it has, with Undo and Done,
    // and a line at the top says how to add, move and remove stops. The panel tucks away to show the map.
    let routeBarShown = false;
    $: syncRouteBar(currentMode === "waypoint-edit" ? selectedBot : null, $routeUndoCountStore, $mobileLayoutStore);

    function syncRouteBar(bot: BotData | null, undoCount: number, phone: boolean) {
        if (!bot) {
            hideRouteBar();
            return;
        }
        if (!routeBarShown) {
            routeBarShown = true;
            mapEditorVisibilityStore.set(false);
        }
        const page = $LL.mapEditor.edit.bots.page;
        const stops = routeStops(bot).length;
        const loops = bot.behaviorConfig.loop !== false;
        editPlacingBarStore.set({
            title: page.route.title({ name: bot.name || "" }),
            subtitle: `${page.moves.stops({ count: stops })} · ${
                loops ? page.moves.loops() : page.moves.backAndForthBrief()
            }`,
            icon: IconRoute,
            hint: phone ? page.route.hintPhone() : page.route.hintDesktop(),
            actions: [
                {
                    label: page.route.undo(),
                    kind: "secondary",
                    icon: IconArrowBackUp,
                    disabled: undoCount === 0,
                    testId: "bot-route-undo",
                    onClick: undoRouteChange,
                },
                { label: page.route.done(), kind: "primary", testId: "bot-route-done", onClick: stopWaypointEditing },
            ],
        });
    }

    function hideRouteBar() {
        if (!routeBarShown) return;
        routeBarShown = false;
        editPlacingBarStore.set(undefined);
        mapEditorVisibilityStore.set(true);
    }

    onDestroy(() => {
        hideRouteBar();
        editPanelBackStore.set(undefined);
    });
</script>

<div class="bot-editor flex flex-col h-full min-h-0">
    {#if error}
        <div class="bg-red-500/20 border border-red-500/50 rounded-lg p-4 m-4">
            <p class="text-red-200 text-sm">{error}</p>
            <button
                class="mt-2 px-3 py-1 bg-red-500/20 text-red-200 rounded hover:bg-red-500/30 text-xs"
                on:click={() => loadBots()}
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
        <BotList {bots} onSelectBot={handleSelectBot} onCreateBot={handleCreateBot} />
    {:else if currentMode === "create"}
        <NewBotView busy={isLoading} onCreate={handleCreateBotSubmit} onCancel={handleBackToList} />
    {:else if currentMode === "detail" || currentMode === "waypoint-edit"}
        {#if selectedBot}
            <BotDetailView
                bind:this={detailView}
                bot={selectedBot}
                onSave={handleSave}
                onDelete={handleDelete}
                onLocate={() => selectedBot && handleLocateBot(selectedBot.id)}
            />
        {:else}
            <div class="flex items-center justify-center h-full text-white/60">
                <p>No bot selected</p>
            </div>
        {/if}
    {/if}
</div>

<style>
    .bot-editor {
        color: white;
    }

    kbd {
        font-family: monospace;
    }
</style>
