<script lang="ts">
    import type { BotData } from "../types";

    export let bot: BotData;
    export let onSelect: () => void;
    export let onToggle: (bot: BotData, enabled: boolean) => void;

    function getBehaviorLabel(type?: string): string {
        switch (type) {
            case "idle":
                return "Idle";
            case "patrol":
                return "Patrol";
            case "social":
                return "Social";
            default:
                return "Unknown";
        }
    }

    function getBehaviorColor(type?: string): string {
        switch (type) {
            case "idle":
                return "bg-gray-500";
            case "patrol":
                return "bg-blue-500";
            case "social":
                return "bg-green-500";
            default:
                return "bg-gray-500";
        }
    }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div
    class="bot-card bg-white/5 rounded-lg p-4 border border-white/10 hover:border-white/30 hover:bg-white/10 transition-all cursor-pointer {bot.enabled
        ? ''
        : 'opacity-60'}"
    on:click={onSelect}
    role="button"
    tabindex="0"
    on:keydown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect();
        }
    }}
>
    <div class="flex items-start justify-between gap-4">
        <!-- Left: Bot Info -->
        <div class="flex-1 min-w-0">
            <div class="flex items-center gap-3 mb-2">
                <h3 class="text-lg font-semibold text-white truncate">{bot.name || "Unnamed Bot"}</h3>
                <span class="px-2 py-0.5 text-xs rounded {getBehaviorColor(bot.behaviorType)} text-white">
                    {getBehaviorLabel(bot.behaviorType)}
                </span>
            </div>

            {#if bot.description}
                <p class="text-sm text-white/70 mb-2 line-clamp-2">{bot.description}</p>
            {/if}

            <div class="flex items-center gap-4 text-xs text-white/50">
                {#if bot.position}
                    <div class="flex items-center gap-1">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                        ({bot.position.x}, {bot.position.y})
                    </div>
                {/if}
                {#if bot.enabled !== undefined}
                    <div class="flex items-center gap-1">
                        {#if bot.enabled}
                            <div class="w-2 h-2 bg-green-400 rounded-full" />
                            <span>Active</span>
                        {:else}
                            <div class="w-2 h-2 bg-gray-400 rounded-full" />
                            <span>Inactive</span>
                        {/if}
                    </div>
                {/if}
            </div>
        </div>

        <!-- Right: Toggle Switch -->
        <div class="flex items-center gap-2" on:click|stopPropagation>
            <label class="relative inline-flex items-center cursor-pointer">
                <input
                    type="checkbox"
                    class="sr-only peer"
                    checked={bot.enabled ?? false}
                    on:change={(e) => {
                        const target = e.currentTarget;
                        if (target instanceof HTMLInputElement) {
                            onToggle(bot, target.checked);
                        }
                    }}
                />
                <div
                    class="w-11 h-6 bg-gray-600 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"
                />
            </label>
        </div>
    </div>
</div>

<style>
    .bot-card {
        transition: all 0.2s ease;
    }

    .bot-card:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }
</style>
