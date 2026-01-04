<script lang="ts">
    import { onMount } from "svelte";
    import type { BotData } from "../types";
    import BotCard from "./BotCard.svelte";

    export let bots: BotData[] = [];
    export let onSelectBot: (bot: BotData | null) => void;
    export let onCreateBot: () => void;

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

    function handleToggleBot(bot: BotData, enabled: boolean) {
        try {
            // TODO: Replace with actual API call
            // await botApiService.updateBot(bot.botId, { enabled });
            bot.enabled = enabled;
            bots = bots; // Trigger reactivity
        } catch (e) {
            console.error("Error toggling bot:", e);
            // Revert on error
            bot.enabled = !enabled;
            bots = bots;
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
</script>

<div class="bot-list h-full flex flex-col">
    <!-- Header -->
    <div class="flex items-center justify-between mb-4 pb-4 border-b border-white/20">
        <div>
            <h2 class="text-xl font-semibold text-white">Bots</h2>
            <p class="text-sm text-white/60 mt-1">
                {bots.length}
                {bots.length === 1 ? "bot" : "bots"} on this map
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
            <div class="grid grid-cols-1 gap-3">
                {#each bots as bot (bot.botId)}
                    <BotCard {bot} onSelect={() => onSelectBot(bot)} onToggle={handleToggleBot} />
                {/each}
            </div>
        {/if}
    </div>
</div>

<style>
    .bot-list {
        color: white;
    }
</style>
