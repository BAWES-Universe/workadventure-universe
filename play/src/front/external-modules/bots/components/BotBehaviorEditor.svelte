<script lang="ts">
    import { onMount } from "svelte";
    import type { BotData } from "../types";

    export let bot: BotData | null = null;

    let behaviorType: "idle" | "patrol" | "social" = "idle";
    let assignedSpaceCenterX = 0;
    let assignedSpaceCenterY = 0;
    let assignedSpaceRadius = 50;

    // Behavior-specific configs
    let patrolWaypoints: Array<{ x: number; y: number }> = [];
    let conversationRadius = 100;
    let minTimeBetweenConversations = 60000;
    let initialized = false;

    // Initialize from bot (only once)
    onMount(() => {
        if (bot && !initialized) {
            behaviorType = bot.behaviorType || "idle";
            if (bot.behaviorConfig?.assignedSpace) {
                assignedSpaceCenterX = bot.behaviorConfig.assignedSpace.center?.x || 0;
                assignedSpaceCenterY = bot.behaviorConfig.assignedSpace.center?.y || 0;
                assignedSpaceRadius = bot.behaviorConfig.assignedSpace.radius || 50;
            }
            if (bot.behaviorConfig?.waypoints) {
                patrolWaypoints = [...bot.behaviorConfig.waypoints];
            }
            if (bot.behaviorConfig?.conversationRadius !== undefined) {
                conversationRadius = bot.behaviorConfig.conversationRadius;
            }
            if (bot.behaviorConfig?.minTimeBetweenConversations !== undefined) {
                minTimeBetweenConversations = bot.behaviorConfig.minTimeBetweenConversations;
            }
            initialized = true;
        }
    });

    // Update bot when values change (avoid cycles by checking initialized)
    function updateBot() {
        if (bot && initialized) {
            bot.behaviorType = behaviorType;
            if (!bot.behaviorConfig) {
                bot.behaviorConfig = {};
            }
            if (!bot.behaviorConfig.assignedSpace) {
                bot.behaviorConfig.assignedSpace = {
                    center: { x: 0, y: 0 },
                    radius: 50,
                };
            }
            bot.behaviorConfig.assignedSpace.center = {
                x: assignedSpaceCenterX,
                y: assignedSpaceCenterY,
            };
            bot.behaviorConfig.assignedSpace.radius = assignedSpaceRadius;

            if (behaviorType === "patrol") {
                bot.behaviorConfig.waypoints = patrolWaypoints;
            }
            if (behaviorType === "social") {
                bot.behaviorConfig.conversationRadius = conversationRadius;
                bot.behaviorConfig.minTimeBetweenConversations = minTimeBetweenConversations;
            }
        }
    }

    function addWaypoint() {
        patrolWaypoints = [...patrolWaypoints, { x: 0, y: 0 }];
        updateBot();
    }

    function removeWaypoint(index: number) {
        patrolWaypoints = patrolWaypoints.filter((_, i) => i !== index);
        updateBot();
    }

    // Update bot when inputs change (use event handlers to avoid cycles)
    function handleBehaviorTypeChange() {
        updateBot();
    }

    function handleAssignedSpaceChange() {
        updateBot();
    }

    function handleConversationRadiusChange() {
        updateBot();
    }

    function handleMinTimeChange() {
        updateBot();
    }
</script>

<div class="space-y-4">
    <div>
        <label class="block text-sm font-medium mb-1">Behavior Type</label>
        <select
            class="w-full px-3 py-2 border border-white/20 rounded bg-white/5 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            bind:value={behaviorType}
            on:change={handleBehaviorTypeChange}
        >
            <option value="idle" class="bg-gray-800 text-white">Idle (Stand in place)</option>
            <option value="patrol" class="bg-gray-800 text-white">Patrol (Follow waypoints)</option>
            <option value="social" class="bg-gray-800 text-white">Social (Seek conversations)</option>
        </select>
    </div>

    <!-- Assigned Space -->
    <div class="border-t pt-4">
        <h3 class="text-sm font-semibold mb-2">Assigned Space</h3>
        <div class="space-y-2">
            <div class="flex gap-2">
                <input
                    type="number"
                    class="w-24 px-3 py-2 border border-white/20 rounded bg-white/5 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    bind:value={assignedSpaceCenterX}
                    on:input={handleAssignedSpaceChange}
                    placeholder="Center X"
                />
                <input
                    type="number"
                    class="w-24 px-3 py-2 border border-white/20 rounded bg-white/5 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    bind:value={assignedSpaceCenterY}
                    on:input={handleAssignedSpaceChange}
                    placeholder="Center Y"
                />
                <input
                    type="number"
                    class="w-24 px-3 py-2 border border-white/20 rounded bg-white/5 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    bind:value={assignedSpaceRadius}
                    on:input={handleAssignedSpaceChange}
                    placeholder="Radius"
                />
            </div>
        </div>
    </div>

    <!-- Behavior-specific configs -->
    {#if behaviorType === "patrol"}
        <div class="border-t pt-4">
            <h3 class="text-sm font-semibold mb-2">Patrol Waypoints</h3>
            {#each patrolWaypoints as waypoint, index (index)}
                <div class="flex gap-2 mb-2">
                    <input
                        type="number"
                        class="w-24 px-3 py-2 border border-white/20 rounded bg-white/5 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        bind:value={waypoint.x}
                        on:input={updateBot}
                        placeholder="X"
                    />
                    <input
                        type="number"
                        class="w-24 px-3 py-2 border border-white/20 rounded bg-white/5 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        bind:value={waypoint.y}
                        on:input={updateBot}
                        placeholder="Y"
                    />
                    <button
                        class="px-3 py-2 bg-red-500/20 text-red-300 rounded hover:bg-red-500/30 transition-colors"
                        on:click={() => removeWaypoint(index)}
                    >
                        Remove
                    </button>
                </div>
            {/each}
            <button
                class="px-4 py-2 bg-blue-500/20 text-blue-300 rounded hover:bg-blue-500/30 transition-colors"
                on:click={addWaypoint}>Add Waypoint</button
            >
        </div>
    {:else if behaviorType === "social"}
        <div class="border-t pt-4">
            <h3 class="text-sm font-semibold mb-2">Social Behavior Settings</h3>
            <div class="space-y-2">
                <div>
                    <label class="block text-sm font-medium mb-1">Conversation Radius</label>
                    <input
                        type="number"
                        class="w-full px-3 py-2 border border-white/20 rounded bg-white/5 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        bind:value={conversationRadius}
                        on:input={handleConversationRadiusChange}
                        placeholder="100"
                    />
                </div>
                <div>
                    <label class="block text-sm font-medium mb-1">Min Time Between Conversations (ms)</label>
                    <input
                        type="number"
                        class="w-full px-3 py-2 border border-white/20 rounded bg-white/5 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        bind:value={minTimeBetweenConversations}
                        on:input={handleMinTimeChange}
                        placeholder="60000"
                    />
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
        background-color: rgb(31 41 55); /* gray-800 */
        color: white;
    }
</style>
