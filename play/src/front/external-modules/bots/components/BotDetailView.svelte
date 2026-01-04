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
            // New bot - initialize with defaults
            currentBot = {
                name: "",
                description: "",
                position: { x: 0, y: 0 },
                behaviorType: "idle",
                enabled: true, // New bots are enabled by default
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
                {currentBot.botId ? "Edit Bot" : "Create New Bot"}
            </h2>
            {#if currentBot.name}
                <p class="text-sm text-white/60 mt-1">{currentBot.name}</p>
            {/if}
        </div>
    </div>

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
