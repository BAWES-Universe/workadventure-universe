<script lang="ts">
    import { onMount } from "svelte";
    import type { BotData } from "../types";

    export let bot: BotData | null = null;

    let name = "";
    let description = "";
    let x = 0;
    let y = 0;
    let characterTexture = "";
    let initialized = false;

    // Initialize from bot (only once)
    onMount(() => {
        if (bot && !initialized) {
            name = bot.name || "";
            description = bot.description || "";
            x = bot.position?.x || 0;
            y = bot.position?.y || 0;
            characterTexture = bot.characterTexture || "";
            initialized = true;
        }
    });

    // Update bot when values change (avoid cycles by checking initialized)
    function updateBot() {
        if (bot && initialized) {
            bot.name = name;
            bot.description = description;
            if (!bot.position) {
                bot.position = { x: 0, y: 0 };
            }
            bot.position.x = x;
            bot.position.y = y;
            bot.characterTexture = characterTexture;
        }
    }

    // Event handlers to update bot
    function handleNameChange() {
        updateBot();
    }

    function handleDescriptionChange() {
        updateBot();
    }

    function handlePositionChange() {
        updateBot();
    }

    function handleTextureChange() {
        updateBot();
    }

    function handlePickPosition() {
        // TODO: Implement position picker from map
        console.log("Pick position from map");
    }
</script>

<div class="space-y-4">
    <div>
        <label class="block text-sm font-medium mb-1">Bot Name</label>
        <input
            type="text"
            class="w-full px-3 py-2 border border-white/20 rounded bg-white/5 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            bind:value={name}
            on:input={handleNameChange}
            placeholder="Enter bot name"
        />
    </div>

    <div>
        <label class="block text-sm font-medium mb-1">Description</label>
        <textarea
            class="w-full px-3 py-2 border border-white/20 rounded bg-white/5 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            bind:value={description}
            on:input={handleDescriptionChange}
            placeholder="Enter bot description"
            rows="3"
        />
    </div>

    <div>
        <label class="block text-sm font-medium mb-1">Position</label>
        <div class="flex gap-2">
            <input
                type="number"
                class="w-24 px-3 py-2 border border-white/20 rounded bg-white/5 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                bind:value={x}
                on:input={handlePositionChange}
                placeholder="X"
            />
            <input
                type="number"
                class="w-24 px-3 py-2 border border-white/20 rounded bg-white/5 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                bind:value={y}
                on:input={handlePositionChange}
                placeholder="Y"
            />
            <button
                class="px-4 py-2 bg-white/10 text-white rounded hover:bg-white/20 transition-colors"
                on:click={handlePickPosition}
            >
                Pick from Map
            </button>
        </div>
    </div>

    <div>
        <label class="block text-sm font-medium mb-1">Character Texture</label>
        <input
            type="text"
            class="w-full px-3 py-2 border border-white/20 rounded bg-white/5 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            bind:value={characterTexture}
            on:input={handleTextureChange}
            placeholder="Character texture ID"
        />
    </div>
</div>
