<script lang="ts">
    import BotPropertiesEditor from "./components/BotPropertiesEditor.svelte";
    import BotBehaviorEditor from "./components/BotBehaviorEditor.svelte";
    import BotAIConfigEditor from "./components/BotAIConfigEditor.svelte";

    interface BotData {
        name?: string;
        description?: string;
        x?: number;
        y?: number;
        characterTexture?: string;
        behaviorType?: "idle" | "patrol" | "social";
        assignedSpace?: {
            center?: { x: number; y: number };
            radius?: number;
        };
        aiProvider?: "lmstudio" | "ultravox" | "gpt-voice";
        chatInstructions?: string;
        movementInstructions?: string;
        apiEndpoint?: string;
        modelName?: string;
        apiKey?: string;
        [key: string]: unknown;
    }

    let activeTab: "properties" | "behavior" | "ai" = "properties";
    let currentBot: BotData | null = null; // Bot being edited

    function handleSave() {
        // TODO: Implement save logic
        console.log("Saving bot:", currentBot);
    }

    function handleDelete() {
        // TODO: Implement delete logic
        console.log("Deleting bot:", currentBot);
    }
</script>

<div class="bot-editor h-full overflow-y-auto">
    <div class="mb-4">
        <h2 class="text-xl font-semibold text-white mb-4">Bot Editor</h2>

        <!-- Tabs -->
        <div class="flex border-b border-white/20 mb-4">
            <button
                class="px-4 py-2 text-sm {activeTab === 'properties'
                    ? 'border-b-2 border-white text-white'
                    : 'text-white/60 hover:text-white'}"
                on:click={() => (activeTab = "properties")}
            >
                Properties
            </button>
            <button
                class="px-4 py-2 text-sm {activeTab === 'behavior'
                    ? 'border-b-2 border-white text-white'
                    : 'text-white/60 hover:text-white'}"
                on:click={() => (activeTab = "behavior")}
            >
                Behavior
            </button>
            <button
                class="px-4 py-2 text-sm {activeTab === 'ai'
                    ? 'border-b-2 border-white text-white'
                    : 'text-white/60 hover:text-white'}"
                on:click={() => (activeTab = "ai")}
            >
                AI Config
            </button>
        </div>
    </div>

    <!-- Content -->
    <div class="space-y-4">
        {#if activeTab === "properties"}
            <BotPropertiesEditor bind:bot={currentBot} />
        {:else if activeTab === "behavior"}
            <BotBehaviorEditor bind:bot={currentBot} />
        {:else if activeTab === "ai"}
            <BotAIConfigEditor bind:bot={currentBot} />
        {/if}
    </div>

    <!-- Footer -->
    <div class="flex items-center justify-end gap-2 mt-6 pt-4 border-t border-white/20">
        {#if currentBot}
            <button class="px-4 py-2 text-red-400 hover:bg-red-500/20 rounded" on:click={handleDelete}> Delete </button>
        {/if}
        <button class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700" on:click={handleSave}> Save </button>
    </div>
</div>

<style>
    .bot-editor {
        color: white;
    }
</style>
