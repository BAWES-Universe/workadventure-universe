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

    // Function to update a bot in the bots array
    function updateBotInList(updatedBot: BotData) {
        const index = bots.findIndex((b) => b.botId === updatedBot.botId);
        if (index !== -1) {
            bots[index] = { ...updatedBot };
            bots = bots; // Trigger reactivity
            // Update selectedBot if it's the same bot
            if (selectedBot?.botId === updatedBot.botId) {
                selectedBot = bots[index];
            }
        }
    }

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
        // Update the bot in the bots array using selectedBot (which was updated via Object.assign)
        if (selectedBot?.botId) {
            updateBotInList(selectedBot);
        }
        // Stay on detail page - don't navigate away
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

<div class="bot-editor flex flex-col h-full min-h-0" style="padding-top: 30px;">
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
