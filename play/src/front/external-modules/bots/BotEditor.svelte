<script lang="ts">
    import BotList from "./components/BotList.svelte";
    import BotDetailView from "./components/BotDetailView.svelte";
    import CreateBotModal from "./components/CreateBotModal.svelte";
    import type { BotData } from "./types";

    type View = "list" | "detail";

    let currentView: View = "list";
    let selectedBot: BotData | null = null;
    let showCreateModal = false;

    function handleSelectBot(bot: BotData | null) {
        selectedBot = bot;
        currentView = "detail";
    }

    function handleCreateBot() {
        showCreateModal = true;
    }

    function handleCreateBotSubmit(name: string, textureId: string) {
        // Create new bot with just name and texture
        selectedBot = {
            name,
            characterTexture: textureId,
            characterTextureIds: [textureId],
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
        showCreateModal = false;
        currentView = "detail";
    }

    function handleCloseCreateModal() {
        showCreateModal = false;
    }

    function handleBackToList() {
        currentView = "list";
        selectedBot = null;
    }

    function handleSave() {
        // After save, return to list
        handleBackToList();
    }

    function handleDelete() {
        // After delete, return to list
        handleBackToList();
    }
</script>

<div class="bot-editor h-full flex flex-col pt-[30px]">
    {#if currentView === "list"}
        <BotList onSelectBot={handleSelectBot} onCreateBot={handleCreateBot} />
    {:else if currentView === "detail"}
        <BotDetailView bot={selectedBot} onBack={handleBackToList} onSave={handleSave} onDelete={handleDelete} />
    {/if}

    <CreateBotModal isOpen={showCreateModal} onClose={handleCloseCreateModal} onCreate={handleCreateBotSubmit} />
</div>

<style>
    .bot-editor {
        color: white;
    }
</style>
