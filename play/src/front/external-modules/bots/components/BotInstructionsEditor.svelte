<script lang="ts">
    import { onMount, createEventDispatcher } from "svelte";
    import { botApiService } from "../services/BotApiService";
    import type { BotData } from "../types";

    export let bot: BotData | null = null;

    const dispatch = createEventDispatcher<{ change: void }>();

    interface AIProvider {
        providerId: string;
        name: string;
        type: string;
        enabled: boolean;
        supportsStreaming: boolean;
    }

    let aiProviderRef: string = "";
    let chatInstructions = "";
    let movementInstructions = "";
    let availableProviders: AIProvider[] = [];
    let isLoadingProviders = false;
    let providerError: string | null = null;

    // Load available providers on mount
    onMount(async () => {
        if (bot) {
            aiProviderRef = bot.aiProviderRef || "";
            chatInstructions = bot.chatInstructions || "";
            movementInstructions = bot.movementInstructions || "";
        }
        await loadProviders();
    });

    async function loadProviders() {
        if (!botApiService.isInitialized()) {
            providerError = "Bot API service not initialized";
            return;
        }

        isLoadingProviders = true;
        providerError = null;

        try {
            availableProviders = await botApiService.getAvailableAIProviders(true);
            if (availableProviders.length === 0) {
                providerError = "No AI providers available. Please configure providers in Admin API.";
            }
        } catch (error) {
            console.error("[BotInstructionsEditor] Error loading providers:", error);
            providerError = "Failed to load AI providers";
        } finally {
            isLoadingProviders = false;
        }
    }

    // Update bot when values change
    function updateAIProviderRef() {
        if (bot) {
            bot.aiProviderRef = aiProviderRef || undefined;
            dispatch("change");
        }
    }

    function updateChatInstructions() {
        if (bot) {
            bot.chatInstructions = chatInstructions;
            dispatch("change");
        }
    }

    function updateMovementInstructions() {
        if (bot) {
            bot.movementInstructions = movementInstructions;
            dispatch("change");
        }
    }
</script>

<div class="space-y-6">
    <!-- AI Provider Selection -->
    <div>
        <label for="ai-provider" class="block text-sm text-white/80 mb-2 font-semibold">
            AI Provider
            <span class="text-white/50 text-xs font-normal ml-2"> (Select the AI provider for this bot) </span>
        </label>
        {#if isLoadingProviders}
            <div class="w-full px-3 py-2 border border-white/20 rounded bg-white/5 text-white/50 text-sm">
                Loading providers...
            </div>
        {:else if providerError}
            <div class="w-full px-3 py-2 border border-red-500/50 rounded bg-red-500/10 text-red-400 text-sm mb-2">
                {providerError}
            </div>
            <button
                class="text-xs text-blue-400 hover:text-blue-300 px-2 py-1 hover:bg-blue-500/10 rounded transition-colors"
                on:click={loadProviders}
            >
                Retry
            </button>
        {:else if availableProviders.length === 0}
            <div class="w-full px-3 py-2 border border-yellow-500/50 rounded bg-yellow-500/10 text-yellow-400 text-sm">
                No AI providers configured. Please set up providers in Admin API first.
            </div>
        {:else}
            <select
                id="ai-provider"
                class="w-full px-3 py-2 border border-white/20 rounded bg-white/5 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                bind:value={aiProviderRef}
                on:change={updateAIProviderRef}
                style="color: white; background-color: rgba(255, 255, 255, 0.05);"
            >
                <option value="" style="background-color: rgba(0, 0, 0, 0.8); color: white;"
                    >-- Select AI Provider --</option
                >
                {#each availableProviders as provider (provider.providerId)}
                    <option value={provider.providerId} style="background-color: rgba(0, 0, 0, 0.8); color: white;">
                        {provider.name}
                        {#if !provider.enabled}(Disabled){/if}
                    </option>
                {/each}
            </select>
        {/if}
        <p class="text-xs text-white/50 mt-2">
            Select an AI provider configured in Admin API. Providers are managed by administrators.
        </p>
    </div>

    <div>
        <label for="chat-instructions" class="block text-sm text-white/80 mb-2 font-semibold">
            Chat instructions
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
        <label for="movement-instructions" class="block text-sm text-white/80 mb-2 font-semibold">
            Movement instructions
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
