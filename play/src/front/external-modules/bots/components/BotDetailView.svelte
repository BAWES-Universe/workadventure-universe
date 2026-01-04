<script lang="ts">
    import type { BotData } from "../types";
    import BotPropertiesEditor from "./BotPropertiesEditor.svelte";
    import BotBehaviorEditor from "./BotBehaviorEditor.svelte";
    import BotInstructionsEditor from "./BotInstructionsEditor.svelte";
    import { IconChevronLeft } from "@wa-icons";

    export let bot: BotData | null = null;
    export let onBack: () => void;
    export let onSave: () => void;
    export let onDelete: () => void;

    let activeTab: "properties" | "behavior" | "instructions" = "properties";
    let currentBot: BotData;
    let isSaving = false;
    let saveError: string | null = null;

    // Initialize bot data
    $: {
        if (bot) {
            currentBot = { ...bot };
        } else {
            // This shouldn't happen anymore - bots are created via modal
            currentBot = {
                name: "",
                description: "",
                position: { x: 0, y: 0 },
                behaviorType: "idle",
                enabled: true,
                behaviorConfig: {
                    assignedSpace: {
                        center: { x: 0, y: 0 },
                        radius: 50,
                    },
                },
                chatInstructions: "",
                movementInstructions: "",
            };
        }
    }

    // Check if this is a new bot (no botId means it hasn't been saved yet)
    $: isNewBot = !currentBot.botId;

    function handleSave() {
        isSaving = true;
        saveError = null;

        try {
            // Validate required fields
            if (!currentBot.name || currentBot.name.trim() === "") {
                saveError = "Bot name is required";
                isSaving = false;
                return;
            }

            // TODO: Replace with actual API call
            // if (currentBot.botId) {
            //     await botApiService.updateBot(currentBot.botId, currentBot);
            // } else {
            //     await botApiService.createBot(currentBot);
            // }

            console.log("Saving bot:", currentBot);
            onSave();
        } catch (e) {
            saveError = e instanceof Error ? e.message : "Failed to save bot";
            console.error("Error saving bot:", e);
        } finally {
            isSaving = false;
        }
    }

    function handleDelete() {
        if (!currentBot.botId) {
            // New bot, just go back
            onBack();
            return;
        }

        if (!confirm(`Are you sure you want to delete "${currentBot.name}"? This cannot be undone.`)) {
            return;
        }

        try {
            // TODO: Replace with actual API call
            // await botApiService.deleteBot(currentBot.botId);
            console.log("Deleting bot:", currentBot.botId);
            onDelete();
        } catch (e) {
            console.error("Error deleting bot:", e);
            alert("Failed to delete bot. Please try again.");
        }
    }
</script>

<div class="bot-detail-view h-full flex flex-col">
    <!-- Header -->
    <div class="flex items-center gap-3 mb-4 pb-4 border-b border-white/20">
        <button class="p-2 hover:bg-white/10 rounded transition-colors" on:click={onBack} title="Back to list">
            <IconChevronLeft font-size="20" />
        </button>
        <div class="flex-1">
            <h2 class="text-xl font-semibold text-white">
                {isNewBot ? "Setup Bot" : "Edit Bot"}
            </h2>
            {#if currentBot.name}
                <p class="text-sm text-white/60 mt-1">{currentBot.name}</p>
            {/if}
        </div>
    </div>

    <!-- Setup Instructions for New Bots -->
    {#if isNewBot}
        <div class="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mb-4">
            <div class="flex items-start gap-3">
                <svg class="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path
                        fill-rule="evenodd"
                        d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                        clip-rule="evenodd"
                    />
                </svg>
                <div class="flex-1">
                    <h3 class="text-sm font-semibold text-white mb-2">Next Steps: Complete Your Bot Setup</h3>
                    <ol class="list-decimal list-inside space-y-2 text-sm text-white/80">
                        <li>
                            <strong>Set Position:</strong> Go to the <strong>Properties</strong> tab and set where your bot
                            should appear on the map. You can enter coordinates manually or use the "Pick from Map" button.
                        </li>
                        <li>
                            <strong>Configure Behavior:</strong> In the <strong>Behavior</strong> tab, choose how your bot
                            should act (Idle, Patrol, or Social) and set up its assigned space.
                        </li>
                        <li>
                            <strong>Add Instructions:</strong> In the <strong>Instructions</strong> tab, write chat instructions
                            (what the bot should say) and movement instructions (how it should move and who to approach).
                        </li>
                        <li>
                            <strong>Save:</strong> Click "Create Bot" at the bottom to save your bot configuration.
                        </li>
                    </ol>
                </div>
            </div>
        </div>
    {/if}

    <!-- Tabs -->
    <div class="flex border-b border-white/20 mb-4">
        <button
            class="px-4 py-2 text-sm font-medium transition-colors {activeTab === 'properties'
                ? 'border-b-2 border-white text-white'
                : 'text-white/60 hover:text-white'}"
            on:click={() => (activeTab = "properties")}
        >
            Properties
        </button>
        <button
            class="px-4 py-2 text-sm font-medium transition-colors {activeTab === 'behavior'
                ? 'border-b-2 border-white text-white'
                : 'text-white/60 hover:text-white'}"
            on:click={() => (activeTab = "behavior")}
        >
            Behavior
        </button>
        <button
            class="px-4 py-2 text-sm font-medium transition-colors {activeTab === 'instructions'
                ? 'border-b-2 border-white text-white'
                : 'text-white/60 hover:text-white'}"
            on:click={() => (activeTab = "instructions")}
        >
            Instructions
        </button>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto space-y-4">
        {#if activeTab === "properties"}
            <BotPropertiesEditor bind:bot={currentBot} />
        {:else if activeTab === "behavior"}
            <BotBehaviorEditor bind:bot={currentBot} />
        {:else if activeTab === "instructions"}
            <BotInstructionsEditor bind:bot={currentBot} />
        {/if}
    </div>

    <!-- Footer -->
    <div class="flex items-center justify-between gap-2 mt-6 pt-4 border-t border-white/20">
        <div>
            {#if saveError}
                <div class="text-sm text-red-400">{saveError}</div>
            {/if}
        </div>
        <div class="flex items-center gap-2">
            {#if currentBot.botId}
                <button
                    class="px-4 py-2 text-red-400 hover:bg-red-500/20 rounded transition-colors"
                    on:click={handleDelete}
                    disabled={isSaving}
                >
                    Delete
                </button>
            {/if}
            <button
                class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                on:click={handleSave}
                disabled={isSaving}
            >
                {#if isSaving}
                    Saving...
                {:else}
                    {currentBot.botId ? "Save Changes" : "Create Bot"}
                {/if}
            </button>
        </div>
    </div>
</div>

<style>
    .bot-detail-view {
        color: white;
    }
</style>
