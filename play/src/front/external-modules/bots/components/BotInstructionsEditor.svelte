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
    let availableProviders: AIProvider[] = [];
    let isLoadingProviders = false;
    let providerError: string | null = null;

    // Load available providers on mount
    onMount(async () => {
        if (bot) {
            console.log(
                "[BotInstructionsEditor] onMount, bot.chatInstructions:",
                bot.chatInstructions?.substring(0, 50)
            );
            aiProviderRef = bot.aiProviderRef || "";
            chatInstructions = bot.chatInstructions || "";
        }
        await loadProviders();
    });

    // Watch for bot ID changes (only sync when bot changes, not on every prop update)
    let lastBotId: string | undefined = undefined;
    $: if (bot && bot.id !== lastBotId) {
        console.log("[BotInstructionsEditor] Bot ID changed, syncing all fields");
        lastBotId = bot.id;
        aiProviderRef = bot.aiProviderRef || "";
        chatInstructions = bot.chatInstructions || "";
    }

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
            } else {
                // Auto-select first provider if bot has no provider and providers are available
                if (bot && !bot.aiProviderRef && !aiProviderRef && availableProviders.length > 0) {
                    // Prefer enabled provider, but allow disabled if that's all we have
                    const enabledProvider = availableProviders.find((p) => p.enabled);
                    aiProviderRef = enabledProvider?.providerId || availableProviders[0].providerId;
                    if (bot) {
                        bot.aiProviderRef = aiProviderRef;
                        dispatch("change");
                    }
                }
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
            console.log("[BotInstructionsEditor] updateAIProviderRef called, new value:", aiProviderRef);
            bot.aiProviderRef = aiProviderRef || undefined;
            console.log("[BotInstructionsEditor] bot.aiProviderRef after update:", bot.aiProviderRef);
            dispatch("change");
        }
    }

    function updateChatInstructions() {
        if (bot) {
            console.log(
                "[BotInstructionsEditor] updateChatInstructions called, new value:",
                chatInstructions.substring(0, 50)
            );
            bot.chatInstructions = chatInstructions;
            console.log(
                "[BotInstructionsEditor] bot.chatInstructions after update:",
                bot.chatInstructions?.substring(0, 50)
            );
            dispatch("change");
        } else {
            console.warn("[BotInstructionsEditor] updateChatInstructions called but bot is null");
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
                required
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
    </div>
</div>
