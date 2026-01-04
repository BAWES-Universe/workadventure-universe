<script lang="ts">
    import { onMount, onDestroy } from "svelte";
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
        type BotEditorMode,
    } from "./stores/BotEditorStore";
    import { getBotEditorTool } from "./phaser/BotEditorTool";

    let showCreateModal = false;
    let botEditorTool = getBotEditorTool();

    // Subscribe to stores
    let currentMode: BotEditorMode = "list";
    let selectedBot: BotData | null = null;
    let bots: BotData[] = [];
    let isPlacing = false;

    const unsubscribeMode = botEditorModeStore.subscribe((mode) => {
        currentMode = mode;
    });

    const unsubscribeSelectedBot = selectedBotStore.subscribe((bot) => {
        selectedBot = bot || null;
    });

    const unsubscribeBots = botPreviewsStore.subscribe((botsMap) => {
        bots = Array.from(botsMap.values());
    });

    const unsubscribePlacing = placingBotStore.subscribe((bot) => {
        isPlacing = !!bot;
    });

    onMount(() => {
        // Activate the Phaser tool
        botEditorTool.activate();
    });

    onDestroy(() => {
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

    function handleCreateBotSubmit(name: string, textureId: string) {
        // Generate a temporary id (in real implementation, this comes from API)
        const id = `bot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Create new bot
        const newBot: BotData = {
            id,
            botId: id, // Keep botId for backward compatibility
            name,
            characterTexture: textureId,
            characterTextureIds: [textureId],
            behaviorType: "idle",
            enabled: true,
            behaviorConfig: {
                behaviorType: "idle",
                assignedSpace: {
                    center: { x: 0, y: 0 },
                    radius: 0, // Idle bots default to radius 0 (stationary)
                },
            },
            chatInstructions: "",
            movementInstructions: "",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        // Close modal first
        showCreateModal = false;

        // Start placement mode - user will click on map to set position
        startPlacingBot(newBot);
    }

    function handleCloseCreateModal() {
        showCreateModal = false;
    }

    function handleBackToList() {
        selectBot(undefined);
        botEditorModeStore.set("list");
    }

    function handleSave() {
        // Update the bot in the store
        if (selectedBot) {
            updateBotInStore(selectedBot);
        }
        // Stay on detail page - don't navigate away
    }

    function handleDelete() {
        // Remove from store
        if (selectedBot?.id) {
            removeBot(selectedBot.id);
        }
        // After delete, return to list
        handleBackToList();
    }

    function handleCancelPlacement() {
        cancelPlacement();
    }

    function handleLocateBot(botId: string) {
        botEditorTool.panToBot(botId);
    }
</script>

<div class="bot-editor flex flex-col h-full min-h-0" style="padding-top: 30px;">
    {#if isPlacing}
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
