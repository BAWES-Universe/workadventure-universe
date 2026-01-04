<script lang="ts">
    import BotList from "./components/BotList.svelte";
    import BotDetailView from "./components/BotDetailView.svelte";
    import type { BotData } from "./types";

    type View = "list" | "detail";

    let currentView: View = "list";
    let selectedBot: BotData | null = null;

    function handleSelectBot(bot: BotData | null) {
        selectedBot = bot;
        currentView = "detail";
    }

    function handleCreateBot() {
        selectedBot = null; // New bot
        currentView = "detail";
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
</div>

<style>
    .bot-editor {
        color: white;
    }
</style>
