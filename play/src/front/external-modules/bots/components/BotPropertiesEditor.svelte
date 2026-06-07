<script lang="ts">
    import { onMount } from "svelte";
    import type { BotData } from "../types";

    export let bot: BotData | null = null;

    let name = "";
    let description = "";
    let characterTexture = "";
    let initialized = false;

    // Initialize from bot (only once)
    onMount(() => {
        if (bot && !initialized) {
            name = bot.name || "";
            description = bot.description || "";
            characterTexture = bot.characterTexture || "";
            initialized = true;
        }
    });

    // Update bot when values change (avoid cycles by checking initialized)
    function updateBot() {
        if (bot && initialized) {
            bot.name = name;
            bot.description = description;
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

    function handleTextureChange() {
        updateBot();
    }
</script>

<div class="space-y-4">
    <div>
        <label for="bot-name-input" class="block text-sm font-medium mb-1">Bot Name</label>
        <input
            type="text"
            id="bot-name-input"
            class="w-full px-3 py-2 border border-white/20 rounded bg-white/5 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            bind:value={name}
            on:input={handleNameChange}
            placeholder="Enter bot name"
        />
    </div>

    <div>
        <label for="bot-description-input" class="block text-sm font-medium mb-1">Description</label>
        <textarea
            id="bot-description-input"
            class="w-full px-3 py-2 border border-white/20 rounded bg-white/5 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            bind:value={description}
            on:input={handleDescriptionChange}
            placeholder="Enter bot description"
            rows="3"
        />
    </div>

    <div>
        <label for="bot-texture-input" class="block text-sm font-medium mb-1">Character Texture</label>
        <input
            type="text"
            id="bot-texture-input"
            class="w-full px-3 py-2 border border-white/20 rounded bg-white/5 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            bind:value={characterTexture}
            on:input={handleTextureChange}
            placeholder="Character texture ID"
        />
    </div>
</div>
