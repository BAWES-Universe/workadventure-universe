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
        visionModel: string | null;
        defaultVision: boolean;
    }

    let aiProviderRef: string = "";
    let availableProviders: AIProvider[] = [];
    let isLoadingProviders = false;
    let providerError: string | null = null;

    // A provider can see images when its model is vision-capable (per tri-state /
    // model-name detection) or when the admin declared a dedicated vision model
    // for it (e.g. deepseek-v4-flash-vision-exp on the DeepSeek entry).
    function isVisionEligible(provider: AIProvider): boolean {
        return resolveVisionSupport(provider.model || "", provider.supportsVision) || !!provider.visionModel;
    }

    // Load available providers on mount
    onMount(async () => {
        if (bot) {
            aiProviderRef = bot.aiProviderRef || "";
        }
        await loadProviders();
    });

    // Watch for bot ID changes (only sync when bot changes, not on every prop update)
    let lastBotId: string | undefined = undefined;
    $: if (bot && bot.id !== lastBotId) {
        lastBotId = bot.id;
        aiProviderRef = bot.aiProviderRef || "";
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
            console.error("[BotProviderEditor] Error loading providers:", error);
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
                        {#if isVisionEligible(provider)}👁 vision{/if}
                        {#if !provider.enabled}(Disabled){/if}
                    </option>
                {/each}
            </select>
        {/if}
        <p class="text-xs text-white/50 mt-2">
            Providers that can see images are marked with 👁 — images sent by players are handled automatically, no extra
            setup needed.
        </p>
    </div>
</div>
