<script lang="ts">
    import { onMount, createEventDispatcher } from "svelte";
    import { botApiService } from "../services/BotApiService";
    import type { BotData } from "../types";
    import { resolveVisionSupport } from "../visionModels";

    export let bot: BotData | null = null;

    const dispatch = createEventDispatcher<{ change: void }>();

    interface AIProvider {
        providerId: string;
        name: string;
        type: string;
        enabled: boolean;
        model: string;
        supportsStreaming: boolean;
        supportsVision: boolean | null;
    }

    let aiProviderRef: string = "";
    let chatInstructions = "";
    let visionFallbackProviderRef = "";
    let visionFallbackModel = "";
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
            visionFallbackProviderRef = bot.visionFallbackProviderRef || "";
            visionFallbackModel = bot.visionFallbackModel || "";
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
        visionFallbackProviderRef = bot.visionFallbackProviderRef || "";
        visionFallbackModel = bot.visionFallbackModel || "";
    }

    // Reactive: does the selected main provider support vision?
    $: selectedProvider = availableProviders.find((p) => p.providerId.toLowerCase() === aiProviderRef.toLowerCase());
    $: mainProviderSupportsVision = selectedProvider
        ? resolveVisionSupport(selectedProvider.model || "", selectedProvider.supportsVision)
        : false;
    // Fallback provider options: all providers — the main provider is allowed too,
    // because a vision fallback can reuse the same provider entry with a different
    // model via the fallback model field (e.g. deepseek-v4-flash main + vision-exp fallback).
    $: fallbackProviderOptions = availableProviders;
    $: fallbackIsMainProvider =
        visionFallbackProviderRef && visionFallbackProviderRef.toLowerCase() === aiProviderRef.toLowerCase();

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

    function updateVisionFallbackProviderRef() {
        if (bot) {
            bot.visionFallbackProviderRef = visionFallbackProviderRef || undefined;
            // If the fallback provider changed, clear a stale model override unless
            // it was explicitly set for the new provider.
            if (!visionFallbackModel && bot.visionFallbackModel) {
                bot.visionFallbackModel = undefined;
            }
            dispatch("change");
        }
    }

    function updateVisionFallbackModel() {
        if (bot) {
            bot.visionFallbackModel = visionFallbackModel || undefined;
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
                required
            >
                {#each availableProviders as provider (provider.providerId)}
                    <option value={provider.providerId} style="background-color: rgba(0, 0, 0, 0.8); color: white;">
                        {provider.name}
                        {#if resolveVisionSupport(provider.model || "", provider.supportsVision)}👁 vision{/if}
                        {#if !provider.enabled}(Disabled){/if}
                    </option>
                {/each}
            </select>
        {/if}
        <p class="text-xs text-white/50 mt-2">
            Select an AI provider configured in Admin API. Providers are managed by administrators.
        </p>
    </div>

    <!-- Vision fallback (only relevant when the main model is text-only) -->
    <div class="border border-white/15 rounded-lg p-4">
        <div class="flex items-center justify-between mb-2">
            <div class="block text-sm text-white/80 font-semibold">
                Vision fallback
                <span class="text-white/50 text-xs font-normal ml-2"> (Describe images the main model can't see) </span>
            </div>
            {#if mainProviderSupportsVision}
                <span class="text-xs text-emerald-400"> Fallback ignored — main model already supports vision </span>
            {/if}
        </div>

        {#if !mainProviderSupportsVision}
            <div class="space-y-4">
                <div>
                    <label for="vision-fallback-provider" class="block text-xs text-white/60 mb-1">
                        Fallback provider
                    </label>
                    {#if fallbackProviderOptions.length === 0}
                        <div
                            class="w-full px-3 py-2 border border-yellow-500/50 rounded bg-yellow-500/10 text-yellow-400 text-sm"
                        >
                            No other providers available. Configure a vision-capable provider in Admin API first.
                        </div>
                    {:else}
                        <select
                            id="vision-fallback-provider"
                            class="w-full px-3 py-2 border border-white/20 rounded bg-white/5 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            bind:value={visionFallbackProviderRef}
                            on:change={updateVisionFallbackProviderRef}
                            style="color: white; background-color: rgba(255, 255, 255, 0.05);"
                        >
                            <option value="" style="background-color: rgba(0, 0, 0, 0.8); color: white;">
                                None (image URLs are passed as text)
                            </option>
                            {#each fallbackProviderOptions as provider (provider.providerId)}
                                <option
                                    value={provider.providerId}
                                    style="background-color: rgba(0, 0, 0, 0.8); color: white;"
                                >
                                    {provider.name}
                                    {#if resolveVisionSupport(provider.model || "", provider.supportsVision)}👁 vision{/if}
                                    {#if !provider.enabled}(Disabled){/if}
                                </option>
                            {/each}
                        </select>
                    {/if}
                </div>
                {#if visionFallbackProviderRef}
                    <div>
                        <label for="vision-fallback-model" class="block text-xs text-white/60 mb-1">
                            Fallback model
                            <span class="text-white/40">(optional — defaults to the provider's model)</span>
                        </label>
                        <input
                            id="vision-fallback-model"
                            type="text"
                            class="w-full px-3 py-2 border border-white/20 rounded bg-white/5 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            bind:value={visionFallbackModel}
                            on:change={updateVisionFallbackModel}
                            placeholder="e.g., gemini-2.0-flash"
                        />
                        {#if fallbackIsMainProvider}
                            <p class="text-xs text-amber-400/90 mt-1">
                                Same as the main provider — set a vision-capable model here (e.g. the vision variant of
                                your provider's model) or the fallback has nothing new to offer.
                            </p>
                        {:else}
                            <p class="text-xs text-white/50 mt-1">
                                Used when someone sends an image to a bot whose main model is text-only — the fallback
                                describes the image and the main model reads the description. Leave empty to use the
                                provider's own model.
                            </p>
                        {/if}
                    </div>
                {/if}
            </div>
        {/if}
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
