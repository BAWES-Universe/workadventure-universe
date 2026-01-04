<script lang="ts">
    import BotList from "./components/BotList.svelte";
    import BotDetailView from "./components/BotDetailView.svelte";
    import CreateBotModal from "./components/CreateBotModal.svelte";
    import type { BotData } from "./types";

    type View = "list" | "detail";

    let currentView: View = "list";
    let selectedBot: BotData | null = null;
    let showCreateModal = false;
    let bots: BotData[] = [];

    function handleSelectBot(bot: BotData | null) {
        selectedBot = bot;
        currentView = "detail";
    }

    function handleCreateBot() {
        showCreateModal = true;
    }

    function handleCreateBotSubmit(name: string, textureId: string) {
        // Generate a temporary botId (in real implementation, this comes from API)
        const botId = `bot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Create new bot with botId (immediately saved)
        const newBot: BotData = {
            botId,
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
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        // TODO: Replace with actual API call
        // await botApiService.createBot(newBot);

        // Add to list
        bots = [...bots, newBot];

        // Navigate to detail page
        selectedBot = newBot;
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
        // After save, refresh the list and return to it
        handleBackToList();
    }

    function handleDelete() {
        // Remove from list
        const botIdToDelete = selectedBot?.botId;
        if (botIdToDelete) {
            bots = bots.filter((b) => b.botId !== botIdToDelete);
        }
        // After delete, return to list
        handleBackToList();
    }
</script>

<div class="bot-editor h-full flex flex-col pt-[30px]">
    {#if currentView === "list"}
        <BotList bind:bots onSelectBot={handleSelectBot} onCreateBot={handleCreateBot} />
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
