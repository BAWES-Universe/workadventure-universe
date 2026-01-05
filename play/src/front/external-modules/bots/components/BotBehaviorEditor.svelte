<script lang="ts">
    import { onMount, onDestroy, createEventDispatcher } from "svelte";
    import type { BotData } from "../types";
    import { startWaypointEditing, upsertBot, selectedBotStore } from "../stores/BotEditorStore";

    export let bot: BotData | null = null;

    const dispatch = createEventDispatcher<{ locate: void; editWaypoints: void; change: void }>();

    let behaviorType: "idle" | "patrol" | "social" = "idle";
    let assignedSpaceRadius = 0;
    let conversationRadius = 100;
    let minTimeBetweenConversations = 60000;
    let initialized = false;
    let isUserEditing = false; // Track if user is actively editing to prevent external updates

    // Subscribe to store for real-time updates from map
    const unsubscribe = selectedBotStore.subscribe((storeBot) => {
        // Only sync from store if we're not actively editing
        if (storeBot && storeBot.id === bot?.id && initialized && !isUserEditing) {
            // Sync radius from map changes
            const newRadius = storeBot.behaviorConfig?.assignedSpace?.radius;
            if (newRadius !== undefined && newRadius !== assignedSpaceRadius) {
                assignedSpaceRadius = newRadius;
            }
            // Sync conversation radius from map changes
            const newConvRadius = storeBot.behaviorConfig?.conversationRadius;
            if (newConvRadius !== undefined && newConvRadius !== conversationRadius) {
                conversationRadius = newConvRadius;
            }
        }
    });

    onDestroy(() => {
        unsubscribe();
    });

    // Initialize from bot
    onMount(() => {
        if (bot && !initialized) {
            behaviorType = bot.behaviorConfig?.behaviorType || bot.behaviorType || "idle";
            assignedSpaceRadius = bot.behaviorConfig?.assignedSpace?.radius ?? (behaviorType === "idle" ? 0 : 50);
            if (bot.behaviorConfig?.conversationRadius !== undefined) {
                conversationRadius = bot.behaviorConfig.conversationRadius;
            }
            if (bot.behaviorConfig?.minTimeBetweenConversations !== undefined) {
                minTimeBetweenConversations = bot.behaviorConfig.minTimeBetweenConversations;
            }
            initialized = true;
        }
    });

    // Update bot and sync to store
    function updateBot() {
        if (bot && initialized) {
            bot.behaviorType = behaviorType;
            if (!bot.behaviorConfig) {
                bot.behaviorConfig = {
                    assignedSpace: {
                        center: { x: 0, y: 0 },
                        radius: behaviorType === "idle" ? 0 : 50,
                    },
                };
            }
            bot.behaviorConfig.behaviorType = behaviorType;
            if (!bot.behaviorConfig.assignedSpace) {
                bot.behaviorConfig.assignedSpace = {
                    center: { x: 0, y: 0 },
                    radius: behaviorType === "idle" ? 0 : 50,
                };
            }
            bot.behaviorConfig.assignedSpace.radius = assignedSpaceRadius;

            if (behaviorType === "social") {
                // Ensure conversation radius doesn't exceed movement area
                if (conversationRadius > assignedSpaceRadius) {
                    conversationRadius = assignedSpaceRadius;
                }
                bot.behaviorConfig.conversationRadius = conversationRadius;
                bot.behaviorConfig.minTimeBetweenConversations = minTimeBetweenConversations;
            }

            // Sync to store for real-time map preview
            if (bot.id) {
                upsertBot(bot);
            }

            // Notify parent of change
            dispatch("change");
        }
    }

    // Handle behavior type change
    function handleBehaviorTypeChange() {
        if (behaviorType === "idle") {
            assignedSpaceRadius = 0;
        } else if (behaviorType === "social") {
            // Set good defaults for social bots
            if (assignedSpaceRadius < 100) {
                assignedSpaceRadius = 150; // Movement area
            }
            if (conversationRadius === 0 || conversationRadius > assignedSpaceRadius) {
                conversationRadius = Math.min(80, assignedSpaceRadius); // Detection range (smaller)
            }
        } else if (behaviorType === "patrol") {
            // Set reasonable default for patrol
            if (assignedSpaceRadius < 50) {
                assignedSpaceRadius = 100;
            }
        } else if (assignedSpaceRadius === 0) {
            assignedSpaceRadius = 100;
        }
        updateBot();
    }

    // Handle radius slider change
    function handleRadiusChange() {
        // Ensure conversation radius stays within bounds
        if (behaviorType === "social" && conversationRadius > assignedSpaceRadius) {
            conversationRadius = assignedSpaceRadius;
        }
        updateBot();
    }

    // Handle social settings change
    function handleSocialSettingsChange() {
        updateBot();
    }

    // Handle locate button
    function handleLocate() {
        dispatch("locate");
    }

    // Handle edit waypoints
    function handleEditWaypoints() {
        if (bot?.id) {
            startWaypointEditing();
        }
        dispatch("editWaypoints");
    }

    // Ensure radius is 0 for idle
    $: if (behaviorType === "idle" && assignedSpaceRadius !== 0) {
        assignedSpaceRadius = 0;
        if (initialized) updateBot();
    }

    // Get position display
    $: positionX = bot?.behaviorConfig?.assignedSpace?.center?.x ?? 0;
    $: positionY = bot?.behaviorConfig?.assignedSpace?.center?.y ?? 0;
    $: waypointCount = bot?.behaviorConfig?.patrolWaypoints?.length ?? 0;
</script>

<div class="space-y-4">
    <!-- Behavior Type -->
    <div>
        <label for="behavior-type" class="block text-sm font-medium mb-2 text-white/80">Behavior Type</label>
        <select
            id="behavior-type"
            class="w-full px-3 py-2.5 border border-white/20 rounded-lg bg-white/5 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            bind:value={behaviorType}
            on:change={handleBehaviorTypeChange}
        >
            <option value="idle" class="bg-gray-800 text-white">🧍 Idle - Stand in place</option>
            <option value="patrol" class="bg-gray-800 text-white">🚶 Patrol - Walk a route</option>
            <option value="social" class="bg-gray-800 text-white">💬 Social - Seek conversations</option>
        </select>
    </div>

    <!-- Location Section -->
    <div class="bg-white/5 rounded-lg p-4 border border-white/10">
        <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-semibold text-white/90">Position</h3>
            <button
                class="text-xs px-3 py-1.5 bg-blue-500/20 text-blue-300 rounded hover:bg-blue-500/30 transition-colors flex items-center gap-1"
                on:click={handleLocate}
            >
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                Locate
            </button>
        </div>

        <div class="flex items-center gap-3 text-white/70">
            <div class="flex items-center gap-2 bg-white/5 px-3 py-2 rounded">
                <span class="text-xs text-white/50">X:</span>
                <span class="font-mono">{Math.round(positionX)}</span>
            </div>
            <div class="flex items-center gap-2 bg-white/5 px-3 py-2 rounded">
                <span class="text-xs text-white/50">Y:</span>
                <span class="font-mono">{Math.round(positionY)}</span>
            </div>
        </div>

        <p class="text-xs text-white/50 mt-2 flex items-center gap-1">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
            </svg>
            Drag the bot on the map to change position
        </p>
    </div>

    <!-- Radius Section (non-idle only) -->
    {#if behaviorType !== "idle"}
        <div class="bg-white/5 rounded-lg p-4 border border-white/10">
            <div class="flex items-center justify-between mb-3">
                <h3 class="text-sm font-semibold text-white/90">Movement Area</h3>
                <span class="text-sm font-mono text-white/60">{assignedSpaceRadius}px</span>
            </div>

            <input
                type="range"
                class="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-blue-500"
                min={behaviorType === "social" ? conversationRadius : 16}
                max="500"
                step="16"
                bind:value={assignedSpaceRadius}
                on:mousedown={() => (isUserEditing = true)}
                on:mouseup={() => (isUserEditing = false)}
                on:touchstart={() => (isUserEditing = true)}
                on:touchend={() => (isUserEditing = false)}
                on:input={handleRadiusChange}
            />

            <div class="flex justify-between text-xs text-white/40 mt-1">
                <span>Small (16)</span>
                <span>Large (500)</span>
            </div>

            <p class="text-xs text-white/50 mt-3 flex items-center gap-1">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                </svg>
                {#if behaviorType === "social"}
                    Boundary where bot wanders. Detection range (purple) must be smaller.
                {:else if behaviorType === "patrol"}
                    Safety boundary - all waypoints must be inside this circle.
                {:else}
                    Drag the circle edge on the map for precise control
                {/if}
            </p>
        </div>
    {:else}
        <div class="bg-blue-500/10 rounded-lg p-4 border border-blue-500/20">
            <p class="text-sm text-blue-200 flex items-center gap-2">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                </svg>
                Idle bots stay in place. Change behavior type to enable movement.
            </p>
        </div>
    {/if}

    <!-- Patrol Waypoints -->
    {#if behaviorType === "patrol"}
        <div class="bg-green-500/10 rounded-lg p-4 border border-green-500/20">
            <div class="flex items-center justify-between mb-3">
                <h3 class="text-sm font-semibold text-green-200">Patrol Route</h3>
                <span class="text-xs bg-green-500/20 px-2 py-1 rounded text-green-300">
                    {waypointCount}
                    {waypointCount === 1 ? "point" : "points"}
                </span>
            </div>

            <button
                class="w-full px-4 py-3 bg-green-500/20 text-green-200 rounded-lg hover:bg-green-500/30 transition-colors flex items-center justify-center gap-2 font-medium"
                on:click={handleEditWaypoints}
            >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
                    />
                </svg>
                Edit Waypoints on Map
            </button>

            <p class="text-xs text-white/50 mt-3">
                Click to open the visual waypoint editor. Add points by clicking "+", drag to reposition, click "×" to
                remove.
            </p>
            <div class="mt-3 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded">
                <p class="text-xs text-yellow-200">
                    <strong>Important:</strong> All waypoints must be placed within the Movement Area circle above. The radius
                    acts as a safety boundary - if the bot strays outside (due to pathfinding issues or obstacles), it will
                    return to the assigned space.
                </p>
            </div>
        </div>
    {/if}

    <!-- Social Settings -->
    {#if behaviorType === "social"}
        <div class="bg-purple-500/10 rounded-lg p-4 border border-purple-500/20">
            <h3 class="text-sm font-semibold text-purple-200 mb-3">Social Settings</h3>

            <div class="space-y-4">
                <div>
                    <div class="flex items-center justify-between mb-2">
                        <label for="conversation-radius" class="text-xs text-white/70">Detection Range</label>
                        <span class="text-xs font-mono text-white/50">{conversationRadius}px</span>
                    </div>
                    <input
                        id="conversation-radius"
                        type="range"
                        class="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-purple-500"
                        min="50"
                        max={assignedSpaceRadius}
                        step="10"
                        bind:value={conversationRadius}
                        on:mousedown={() => (isUserEditing = true)}
                        on:mouseup={() => (isUserEditing = false)}
                        on:touchstart={() => (isUserEditing = true)}
                        on:touchend={() => (isUserEditing = false)}
                        on:input={handleSocialSettingsChange}
                    />
                    <p class="text-xs text-white/40 mt-1">
                        How close a player must be to trigger conversation (max: {assignedSpaceRadius}px). Drag purple
                        circle on map.
                    </p>
                </div>

                <div>
                    <div class="flex items-center justify-between mb-2">
                        <label for="min-time" class="text-xs text-white/70">Cooldown</label>
                        <span class="text-xs font-mono text-white/50"
                            >{Math.round(minTimeBetweenConversations / 1000)}s</span
                        >
                    </div>
                    <input
                        id="min-time"
                        type="range"
                        class="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-purple-500"
                        min="5000"
                        max="300000"
                        step="5000"
                        bind:value={minTimeBetweenConversations}
                        on:input={handleSocialSettingsChange}
                    />
                    <p class="text-xs text-white/40 mt-1">Minimum time before approaching the same person again</p>
                </div>
            </div>
        </div>
    {/if}
</div>

<style>
    select {
        color: white;
    }

    select option {
        background-color: rgb(31 41 55);
        color: white;
    }

    /* Custom range slider styling */
    input[type="range"] {
        -webkit-appearance: none;
        appearance: none;
        background: transparent;
    }

    input[type="range"]::-webkit-slider-runnable-track {
        width: 100%;
        height: 8px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 4px;
    }

    input[type="range"]::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: #3b82f6;
        cursor: pointer;
        margin-top: -6px;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
    }

    input[type="range"]::-moz-range-track {
        width: 100%;
        height: 8px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 4px;
    }

    input[type="range"]::-moz-range-thumb {
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: #3b82f6;
        cursor: pointer;
        border: none;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
    }

    /* Purple accent for social sliders */
    .bg-purple-500\/10 input[type="range"]::-webkit-slider-thumb {
        background: #a855f7;
    }

    .bg-purple-500\/10 input[type="range"]::-moz-range-thumb {
        background: #a855f7;
    }
</style>
