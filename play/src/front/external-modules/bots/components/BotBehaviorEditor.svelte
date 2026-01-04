<script lang="ts">
    interface BotData {
        behaviorType?: "idle" | "patrol" | "social";
        assignedSpace?: {
            center?: { x: number; y: number };
            radius?: number;
        };
        [key: string]: unknown;
    }

    export let bot: BotData | null = null;

    let behaviorType: "idle" | "patrol" | "social" = "idle";
    let assignedSpaceCenterX = 0;
    let assignedSpaceCenterY = 0;
    let assignedSpaceRadius = 50;

    // Behavior-specific configs
    let patrolWaypoints: Array<{ x: number; y: number }> = [];
    let conversationRadius = 100;
    let minTimeBetweenConversations = 60000;

    $: if (bot) {
        behaviorType = bot.behaviorType || "idle";
        if (bot.assignedSpace) {
            assignedSpaceCenterX = bot.assignedSpace.center?.x || 0;
            assignedSpaceCenterY = bot.assignedSpace.center?.y || 0;
            assignedSpaceRadius = bot.assignedSpace.radius || 50;
        }
    }

    function addWaypoint() {
        patrolWaypoints = [...patrolWaypoints, { x: 0, y: 0 }];
    }

    function removeWaypoint(index: number) {
        patrolWaypoints = patrolWaypoints.filter((_, i) => i !== index);
    }
</script>

<div class="space-y-4">
    <div>
        <label class="block text-sm font-medium mb-1">Behavior Type</label>
        <select class="w-full px-3 py-2 border rounded" bind:value={behaviorType}>
            <option value="idle">Idle (Stand in place)</option>
            <option value="patrol">Patrol (Follow waypoints)</option>
            <option value="social">Social (Seek conversations)</option>
        </select>
    </div>

    <!-- Assigned Space -->
    <div class="border-t pt-4">
        <h3 class="text-sm font-semibold mb-2">Assigned Space</h3>
        <div class="space-y-2">
            <div class="flex gap-2">
                <input
                    type="number"
                    class="w-24 px-3 py-2 border rounded"
                    bind:value={assignedSpaceCenterX}
                    placeholder="Center X"
                />
                <input
                    type="number"
                    class="w-24 px-3 py-2 border rounded"
                    bind:value={assignedSpaceCenterY}
                    placeholder="Center Y"
                />
                <input
                    type="number"
                    class="w-24 px-3 py-2 border rounded"
                    bind:value={assignedSpaceRadius}
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
                        class="w-24 px-3 py-2 border rounded"
                        bind:value={waypoint.x}
                        placeholder="X"
                    />
                    <input
                        type="number"
                        class="w-24 px-3 py-2 border rounded"
                        bind:value={waypoint.y}
                        placeholder="Y"
                    />
                    <button
                        class="px-3 py-2 bg-red-200 rounded hover:bg-red-300"
                        on:click={() => removeWaypoint(index)}
                    >
                        Remove
                    </button>
                </div>
            {/each}
            <button class="px-4 py-2 bg-blue-200 rounded hover:bg-blue-300" on:click={addWaypoint}>Add Waypoint</button>
        </div>
    {:else if behaviorType === "social"}
        <div class="border-t pt-4">
            <h3 class="text-sm font-semibold mb-2">Social Behavior Settings</h3>
            <div class="space-y-2">
                <div>
                    <label class="block text-sm font-medium mb-1">Conversation Radius</label>
                    <input
                        type="number"
                        class="w-full px-3 py-2 border rounded"
                        bind:value={conversationRadius}
                        placeholder="100"
                    />
                </div>
                <div>
                    <label class="block text-sm font-medium mb-1">Min Time Between Conversations (ms)</label>
                    <input
                        type="number"
                        class="w-full px-3 py-2 border rounded"
                        bind:value={minTimeBetweenConversations}
                        placeholder="60000"
                    />
                </div>
            </div>
        </div>
    {/if}
</div>
