<script lang="ts">
    import BotTexturePicker from "./BotTexturePicker.svelte";

    export let isOpen: boolean = false;
    export let onClose: () => void;
    export let onCreate: (name: string, textureId: string) => void;

    let botName = "";
    let textureId = "";
    let error: string | null = null;

    function handleTextureSelect(selectedId: string) {
        textureId = selectedId;
        error = null; // Clear error when texture is selected
    }

    function handleSubmit() {
        error = null;

        if (!botName || botName.trim() === "") {
            error = "Bot name is required";
            return;
        }

        if (!textureId || textureId.trim() === "") {
            error = "Please select a character texture";
            return;
        }

        onCreate(botName.trim(), textureId.trim());
        // Reset form
        botName = "";
        textureId = "";
        error = null;
    }

    function handleCancel() {
        botName = "";
        textureId = "";
        error = null;
        onClose();
    }

    // Close on Escape key
    function handleKeydown(e: KeyboardEvent) {
        if (e.key === "Escape") {
            handleCancel();
        }
    }
</script>

{#if isOpen}
    <!-- Backdrop -->
    <div
        class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
        tabindex="-1"
        on:click={handleCancel}
        on:keydown={handleKeydown}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-bot-title"
    >
        <!-- Modal -->
        <div
            class="bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 border border-white/20"
            role="dialog"
            on:click|stopPropagation
        >
            <h2 id="create-bot-title" class="text-xl font-semibold text-white mb-4">Create New Bot</h2>

            <div class="space-y-4">
                <!-- Bot Name -->
                <div>
                    <label for="bot-name" class="block text-sm font-medium text-white mb-2">
                        Bot Name <span class="text-red-400">*</span>
                    </label>
                    <input
                        id="bot-name"
                        type="text"
                        class="w-full px-3 py-2 border border-white/20 rounded bg-white/5 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        bind:value={botName}
                        placeholder="Enter bot name"
                        autofocus
                    />
                </div>

                <!-- Character Texture -->
                <div>
                    <div class="block text-sm font-medium text-white mb-2">
                        Character Texture <span class="text-red-400">*</span>
                    </div>
                    <div class="border border-white/20 rounded bg-white/5 p-4">
                        <BotTexturePicker selectedTextureId={textureId} onSelect={handleTextureSelect} />
                    </div>
                    {#if !textureId}
                        <p class="text-xs text-white/50 mt-2">Please select a character texture from above</p>
                    {/if}
                </div>

                {#if error}
                    <div class="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded p-2">
                        {error}
                    </div>
                {/if}
            </div>

            <!-- Actions -->
            <div class="flex items-center justify-end gap-3 mt-6">
                <button
                    class="px-4 py-2 text-white/70 hover:text-white hover:bg-white/10 rounded transition-colors"
                    on:click={handleCancel}
                >
                    Cancel
                </button>
                <button
                    class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                    on:click={handleSubmit}
                >
                    Create Bot
                </button>
            </div>
        </div>
    </div>
{/if}
