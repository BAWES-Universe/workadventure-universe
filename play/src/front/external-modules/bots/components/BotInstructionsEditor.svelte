<script lang="ts">
    import { onMount } from "svelte";
    import type { BotData } from "../types";

    export let bot: BotData | null = null;

    let chatInstructions = "";
    let movementInstructions = "";

    // Initialize from bot
    onMount(() => {
        if (bot) {
            chatInstructions = bot.chatInstructions || "";
            movementInstructions = bot.movementInstructions || "";
        }
    });

    // Update bot when values change
    function updateChatInstructions() {
        if (bot) {
            bot.chatInstructions = chatInstructions;
        }
    }

    function updateMovementInstructions() {
        if (bot) {
            bot.movementInstructions = movementInstructions;
        }
    }
</script>

<div class="space-y-6">
    <div>
        <label for="chat-instructions" class="block text-sm font-medium mb-2 text-white">
            Chat Instructions
            <span class="text-white/50 text-xs font-normal ml-2">
                (What the bot should say and how it should communicate)
            </span>
        </label>
        <textarea
            id="chat-instructions"
            class="w-full px-3 py-2 border border-white/20 rounded bg-white/5 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            bind:value={chatInstructions}
            on:input={updateChatInstructions}
            placeholder="Example: You are a friendly greeter bot named 'WelcomeBot'. Your job is to welcome new visitors to the lobby. Be cheerful and helpful. Answer questions about the space. Don't repeat the same greeting to someone you've already greeted today."
            rows="8"
        />
        <p class="text-xs text-white/50 mt-2">
            These instructions are sent to the AI provider to guide the bot's conversation style and personality. They
            are stored securely in the Admin API.
        </p>
    </div>

    <div>
        <label for="movement-instructions" class="block text-sm font-medium mb-2 text-white">
            Movement Instructions
            <span class="text-white/50 text-xs font-normal ml-2"> (How the bot should move and who to approach) </span>
        </label>
        <textarea
            id="movement-instructions"
            class="w-full px-3 py-2 border border-white/20 rounded bg-white/5 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            bind:value={movementInstructions}
            on:input={updateMovementInstructions}
            placeholder="Example: Stand near the main entrance (coordinates 500, 300). When a new visitor enters, approach them within 5 tiles. After greeting, return to your position near the entrance. Don't follow visitors into private areas. Stay within the lobby area."
            rows="8"
        />
        <p class="text-xs text-white/50 mt-2">
            These instructions guide the bot's movement behavior and decision-making about who to approach. They are
            stored securely in the Admin API.
        </p>
    </div>

    <div class="bg-blue-500/10 border border-blue-500/30 rounded p-4">
        <div class="flex items-start gap-3">
            <svg class="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path
                    fill-rule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                    clip-rule="evenodd"
                />
            </svg>
            <div class="text-sm text-white/80">
                <p class="font-medium mb-1">Tips for Writing Instructions</p>
                <ul class="list-disc list-inside space-y-1 text-white/60">
                    <li>Be specific about the bot's role and personality</li>
                    <li>Include what the bot should and shouldn't do</li>
                    <li>Mention any boundaries or restrictions</li>
                    <li>For movement, reference coordinates or landmarks when possible</li>
                </ul>
            </div>
        </div>
    </div>
</div>
