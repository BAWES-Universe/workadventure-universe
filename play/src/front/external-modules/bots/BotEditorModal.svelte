<script lang="ts">
    import { onMount } from "svelte";
    import BotPropertiesEditor from "./components/BotPropertiesEditor.svelte";
    import BotBehaviorEditor from "./components/BotBehaviorEditor.svelte";
    import BotAIConfigEditor from "./components/BotAIConfigEditor.svelte";
    import type { BotData } from "./types";

    export let isOpen: boolean = false;
    export let onClose: () => void;

    let activeTab: "properties" | "behavior" | "ai" = "properties";
    let currentBot: BotData | null = null; // Bot being edited

    function handleClose() {
        isOpen = false;
        onClose();
    }

    function handleSave() {
        // TODO: Implement save logic
        console.log("Saving bot:", currentBot);
    }

    function handleDelete() {
        // TODO: Implement delete logic
        console.log("Deleting bot:", currentBot);
    }

    onMount(() => {
        // Load existing bots from WAM file
        // TODO: Implement WAM file reading
    });
</script>

{#if isOpen}
    <div class="fixed inset-0 z-[2000] flex items-center justify-center bg-black/50" on:click={handleClose}>
        <div
            class="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
            on:click|stopPropagation
        >
            <!-- Header -->
            <div class="flex items-center justify-between p-4 border-b">
                <h2 class="text-xl font-semibold">Bot Editor</h2>
                <button class="text-gray-500 hover:text-gray-700" on:click={handleClose}>✕</button>
            </div>

            <!-- Tabs -->
            <div class="flex border-b">
                <button
                    class="px-4 py-2 {activeTab === 'properties' ? 'border-b-2 border-blue-500' : ''}"
                    on:click={() => (activeTab = "properties")}
                >
                    Properties
                </button>
                <button
                    class="px-4 py-2 {activeTab === 'behavior' ? 'border-b-2 border-blue-500' : ''}"
                    on:click={() => (activeTab = "behavior")}
                >
                    Behavior
                </button>
                <button
                    class="px-4 py-2 {activeTab === 'ai' ? 'border-b-2 border-blue-500' : ''}"
                    on:click={() => (activeTab = "ai")}
                >
                    AI Config
                </button>
            </div>

            <!-- Content -->
            <div class="flex-1 overflow-y-auto p-4">
                {#if activeTab === "properties"}
                    <BotPropertiesEditor bind:bot={currentBot} />
                {:else if activeTab === "behavior"}
                    <BotBehaviorEditor bind:bot={currentBot} />
                {:else if activeTab === "ai"}
                    <BotAIConfigEditor bind:bot={currentBot} />
                {/if}
            </div>

            <!-- Footer -->
            <div class="flex items-center justify-end gap-2 p-4 border-t">
                <button class="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded" on:click={handleClose}>
                    Cancel
                </button>
                {#if currentBot}
                    <button class="px-4 py-2 text-red-600 hover:bg-red-50 rounded" on:click={handleDelete}>
                        Delete
                    </button>
                {/if}
                <button class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700" on:click={handleSave}>
                    Save
                </button>
            </div>
        </div>
    </div>
{/if}
