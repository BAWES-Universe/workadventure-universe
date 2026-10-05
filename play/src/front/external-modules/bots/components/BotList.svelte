<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import type { BotData } from "../types";
    import { hoveredBotIdStore } from "../stores/BotEditorStore";
    import { setBotEnabled } from "../services/botEnabled";
    import BotCard from "./BotCard.svelte";

    export let bots: BotData[] = [];
    export let onSelectBot: (bot: BotData | null) => void;
    export let onCreateBot: () => void;
    export let onLocateBot: ((botId: string) => void) | undefined = undefined;

    let loading = true;
    let error: string | null = null;

    type Section = "active" | "inactive";
    const COLLAPSED_STORAGE_KEY = "botEditor.collapsedSections";

    // Which section each bot is shown in. It is fixed when the bot first appears in the list,
    // so toggling a bot does not move it away from under the cursor. It settles into the
    // right section the next time the list opens.
    let placement = new Map<string, Section>();
    let togglingIds = new Set<string>();
    let collapsed: Record<Section, boolean> = readCollapsed();

    function readCollapsed(): Record<Section, boolean> {
        try {
            const raw = localStorage.getItem(COLLAPSED_STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw) as Partial<Record<Section, boolean>>;
                return { active: parsed.active === true, inactive: parsed.inactive === true };
            }
        } catch {
            // Storage unavailable; fall back to defaults
        }
        return { active: false, inactive: false };
    }

    function toggleSection(section: Section) {
        collapsed = { ...collapsed, [section]: !collapsed[section] };
        try {
            localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(collapsed));
        } catch {
            // Storage unavailable; the choice lasts until the list closes
        }
    }

    $: {
        const next = new Map<string, Section>();
        for (const bot of bots) {
            next.set(bot.id, placement.get(bot.id) ?? (bot.enabled === false ? "inactive" : "active"));
        }
        placement = next;
    }

    $: sections = (["active", "inactive"] as const).map((key) => ({
        key,
        title: key === "active" ? "Active" : "Inactive",
        bots: bots.filter((bot) => placement.get(bot.id) === key),
    }));

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
        if (togglingIds.has(bot.id)) return;

        // Flip the switch right away and lock it until the API answers
        togglingIds = new Set(togglingIds).add(bot.id);

        try {
            await setBotEnabled(bot, enabled);
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
        } finally {
            const next = new Set(togglingIds);
            next.delete(bot.id);
            togglingIds = next;
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
            <div class="space-y-6">
                {#each sections as section (section.key)}
                    {#if section.bots.length > 0}
                        <div>
                            <button
                                type="button"
                                class="w-full flex items-center gap-2 mb-3 text-sm font-semibold uppercase tracking-wide text-left {section.key ===
                                'active'
                                    ? 'text-white/80'
                                    : 'text-white/60'} hover:text-white"
                                aria-expanded={!collapsed[section.key]}
                                on:click={() => toggleSection(section.key)}
                            >
                                <svg
                                    class="w-4 h-4 transition-transform {collapsed[section.key] ? '-rotate-90' : ''}"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        stroke-width="2"
                                        d="M19 9l-7 7-7-7"
                                    />
                                </svg>
                                {section.title} ({section.bots.length})
                            </button>
                            {#if !collapsed[section.key]}
                                <div class="grid grid-cols-1 gap-3">
                                    {#each section.bots as bot (bot.id)}
                                        {@const botId = bot.id}
                                        <BotCard
                                            {bot}
                                            onSelect={() => {
                                                // Look up bot by ID to ensure we get the latest data
                                                const latestBot = bots.find((b) => b.id === botId);
                                                onSelectBot(latestBot ?? bot);
                                            }}
                                            onToggle={handleToggleBot}
                                            toggling={togglingIds.has(bot.id)}
                                            onHover={handleHoverBot}
                                            onLocate={() => handleLocate(bot)}
                                            showLocateButton={!!onLocateBot}
                                        />
                                    {/each}
                                </div>
                            {/if}
                        </div>
                    {/if}
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
