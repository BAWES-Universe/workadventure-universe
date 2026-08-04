<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import type { BotData } from "../types";
    import { hoveredBotIdStore, upsertBot } from "../stores/BotEditorStore";
    import { botApiService } from "../services/BotApiService";
    import BotCard from "./BotCard.svelte";

    export let bots: BotData[] = [];
    export let onSelectBot: (bot: BotData | null) => void;
    export let onCreateBot: () => void;
    export let onLocateBot: ((botId: string) => void) | undefined = undefined;

    let loading = true;
    let error: string | null = null;

    // Load bots from API
    function loadBots() {
        loading = true;
        error = null;
        try {
            // TODO: Replace with actual API call
            // const response = await botApiService.getBots();
            // bots = response.data;
            // Don't overwrite bots if they're already loaded
            // The parent component manages the bots list
            // This function is mainly for retry scenarios
        } catch (e) {
            error = e instanceof Error ? e.message : "Failed to load bots";
            console.error("Error loading bots:", e);
        } finally {
            loading = false;
        }
    }

    async function handleToggleBot(bot: BotData, enabled: boolean) {
        const originalEnabled = bot.enabled;

        // Don't do optimistic update - wait for API response to prevent duplicate updates
        // The UI will update once when the store updates after API call

        try {
            // Update bot via Admin API
            const updatedBot = await botApiService.updateBot(bot.id, { enabled });

            // Update store with API response - single update prevents duplicates
            // Ensure we always have a valid ID (fallback to original bot.id if API doesn't return it)
            const botId = updatedBot.id || bot.id;
            if (!botId) {
                console.error("[BotList] Cannot update bot: missing ID in both API response and original bot");
                throw new Error("Bot ID is missing");
            }

            const textureId = typeof updatedBot.characterTextureId === "string" ? updatedBot.characterTextureId : "";
            const botData: BotData = {
                id: botId,
                botId: botId,
                name: updatedBot.name || bot.name,
                description: typeof updatedBot.description === "string" ? updatedBot.description : bot.description,
                characterTexture: textureId || bot.characterTexture,
                characterTextureIds: textureId ? [textureId] : bot.characterTextureIds || [],
                behaviorType: (updatedBot.behaviorType as "idle" | "patrol" | "social") || bot.behaviorType,
                enabled: updatedBot.enabled ?? enabled, // Use API response, fallback to requested state
                behaviorConfig: updatedBot.behaviorConfig || bot.behaviorConfig,
                chatInstructions: updatedBot.chatInstructions || bot.chatInstructions || "",
                aiProviderRef: updatedBot.aiProviderRef || bot.aiProviderRef || undefined,
                visionFallbackProviderRef: updatedBot.visionFallbackProviderRef ?? bot.visionFallbackProviderRef,
                visionFallbackModel: updatedBot.visionFallbackModel ?? bot.visionFallbackModel,
                createdAt: updatedBot.createdAt || bot.createdAt || new Date().toISOString(),
                updatedAt: updatedBot.updatedAt || new Date().toISOString(),
                createdBy: updatedBot.createdBy || bot.createdBy || null,
                updatedBy: updatedBot.updatedBy || bot.updatedBy || null,
            };
            // Single upsert call - this will update the store once
            upsertBot(botData);

            // If disabling, despawn the bot immediately
            if (!enabled) {
                try {
                    await botApiService.despawnBot(bot.id);
                    console.log(`[BotList] Despawned bot ${bot.id} after disabling`);
                } catch (despawnError) {
                    console.warn(`[BotList] Failed to despawn bot ${bot.id}:`, despawnError);
                    // Don't revert - the bot is disabled in the database even if despawning failed
                }
            } else {
                // If enabling, spawn the bot if not already spawned
                try {
                    await botApiService.spawnBot(bot.id);
                    console.log(`[BotList] Spawned bot ${bot.id} after enabling`);
                } catch (spawnError) {
                    console.warn(`[BotList] Failed to spawn bot ${bot.id}:`, spawnError);
                    // Don't revert - the bot is enabled in the database
                }
            }
        } catch (e) {
            console.error("Error toggling bot:", e);

            // Check if it's an authentication error
            const errorWithAuth = e as Error & { isAuthError?: boolean; isSessionExpired?: boolean };
            const isAuthError = errorWithAuth?.isAuthError === true;
            const isSessionExpired = errorWithAuth?.isSessionExpired === true;

            if (isAuthError) {
                // Show user-friendly error message
                error = isSessionExpired
                    ? "Your session has expired. Please re-authenticate to continue managing bots."
                    : "Authentication failed. Please ensure you are logged in.";

                // Clear error after 5 seconds
                setTimeout(() => {
                    error = null;
                }, 5000);
            }

            // Revert on error
            upsertBot({ ...bot, enabled: originalEnabled });
        }
    }

    function handleHoverBot(botId: string | undefined) {
        hoveredBotIdStore.set(botId);
    }

    function handleLocate(bot: BotData) {
        if (onLocateBot) {
            onLocateBot(bot.id);
        }
    }

    onMount(() => {
        // Only load if bots array is empty
        // If bots are already provided via prop, skip loading
        if (bots.length === 0) {
            void loadBots();
        } else {
            loading = false;
        }
    });

    onDestroy(() => {
        // Clear hover state when component is destroyed
        hoveredBotIdStore.set(undefined);
    });
</script>

<div class="bot-list h-full flex flex-col">
    <!-- Header -->
    <div class="flex items-center justify-between mb-4 pb-4 border-b border-white/20">
        <div>
            <h2 class="text-xl font-semibold text-white">Bots</h2>
            <p class="text-sm text-white/60 mt-1">
                {bots.length}
                {bots.length === 1 ? "bot" : "bots"} on this map
                {#if bots.length > 0}
                    {@const activeCount = bots.filter((b) => b.enabled !== false).length}
                    {@const inactiveCount = bots.filter((b) => b.enabled === false).length}
                    {#if activeCount > 0 && inactiveCount > 0}
                        <span class="text-white/40"> • {activeCount} active, {inactiveCount} inactive</span>
                    {/if}
                {/if}
            </p>
        </div>
        <button
            class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-2 transition-colors"
            on:click={onCreateBot}
        >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
            Create Bot
        </button>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto">
        {#if loading}
            <div class="flex items-center justify-center py-12 min-h-[200px]">
                <div class="text-white/60">Loading bots...</div>
            </div>
        {:else if error}
            <div class="flex flex-col items-center justify-center py-12 px-4 min-h-[200px] text-red-400">
                <div class="mb-2">{error}</div>
                <button class="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700" on:click={loadBots}>
                    Retry
                </button>
            </div>
        {:else if bots.length === 0}
            <div class="flex flex-col items-center justify-center py-12 px-4 text-white/60 min-h-[200px]">
                <svg class="w-16 h-16 mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"
                    />
                </svg>
                <p class="text-lg mb-2">No bots yet</p>
                <p class="text-sm mb-4 text-center">Create your first bot to get started</p>
                <button class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700" on:click={onCreateBot}>
                    Create Your First Bot
                </button>
            </div>
        {:else}
            {@const activeBots = bots.filter((bot) => bot.enabled !== false)}
            {@const inactiveBots = bots.filter((bot) => bot.enabled === false)}
            <div class="space-y-6">
                <!-- Active Bots Section -->
                {#if activeBots.length > 0}
                    <div>
                        <h3 class="text-sm font-semibold text-white/80 mb-3 uppercase tracking-wide">
                            Active ({activeBots.length})
                        </h3>
                        <div class="grid grid-cols-1 gap-3">
                            {#each activeBots as bot (bot.id)}
                                {#if process.env.NODE_ENV === "development" || process.env.ENABLE_BOT_DEBUG === "true"}
                                    {@const duplicateCheck = bots.filter((b) => b.id === bot.id).length}
                                    {#if duplicateCheck > 1}
                                        <!-- DEBUG: Duplicate detected -->
                                    {/if}
                                {/if}
                                {@const botId = bot.id}
                                <BotCard
                                    {bot}
                                    onSelect={() => {
                                        // Look up bot by ID to ensure we get the latest data
                                        const latestBot = bots.find((b) => b.id === botId);
                                        if (latestBot) {
                                            onSelectBot(latestBot);
                                        } else {
                                            // Fallback to the bot from the loop if not found
                                            onSelectBot(bot);
                                        }
                                    }}
                                    onToggle={handleToggleBot}
                                    onHover={handleHoverBot}
                                    onLocate={() => handleLocate(bot)}
                                    showLocateButton={!!onLocateBot}
                                />
                            {/each}
                        </div>
                    </div>
                {/if}

                <!-- Inactive Bots Section -->
                {#if inactiveBots.length > 0}
                    <div>
                        <h3 class="text-sm font-semibold text-white/60 mb-3 uppercase tracking-wide">
                            Inactive ({inactiveBots.length})
                        </h3>
                        <div class="grid grid-cols-1 gap-3">
                            {#each inactiveBots as bot (bot.id)}
                                {#if process.env.NODE_ENV === "development" || process.env.ENABLE_BOT_DEBUG === "true"}
                                    {@const duplicateCheck = bots.filter((b) => b.id === bot.id).length}
                                    {#if duplicateCheck > 1}
                                        <!-- DEBUG: Duplicate detected -->
                                    {/if}
                                {/if}
                                {@const botId = bot.id}
                                <BotCard
                                    {bot}
                                    onSelect={() => {
                                        // Look up bot by ID to ensure we get the latest data
                                        const latestBot = bots.find((b) => b.id === botId);
                                        if (latestBot) {
                                            onSelectBot(latestBot);
                                        } else {
                                            // Fallback to the bot from the loop if not found
                                            onSelectBot(bot);
                                        }
                                    }}
                                    onToggle={handleToggleBot}
                                    onHover={handleHoverBot}
                                    onLocate={() => handleLocate(bot)}
                                    showLocateButton={!!onLocateBot}
                                />
                            {/each}
                        </div>
                    </div>
                {/if}
            </div>
        {/if}
    </div>
</div>

<style>
    .bot-list {
        color: white;
    }
</style>
