<!--
  BotConversationsView - View and manually clean up conversations
  
  Features:
  - Display recent conversations for a bot
  - Filter by player, date range
  - View full conversation thread with timestamps
  - Show conversation stats (count, oldest, newest)
  - Manual cleanup controls:
    - "Delete older than X days" button
    - "Keep only last N conversations" button
    - Cleanup preview before executing
    - Show cleanup results (how many deleted)
  
  TODO: Implement this component
  - Fetch conversations from API: GET /api/bots/:botId/conversations
  - Display conversation list with filters
  - Show conversation details (messages, timestamps)
  - Implement cleanup controls with confirmation dialogs
  - Call cleanup API: DELETE /api/bots/:botId/conversations/cleanup
-->

<script lang="ts">
    import { onMount } from "svelte";
    // import { botApiService } from '../services/BotApiService'; // TODO: Uncomment when implementing API calls

    export let botId: string;

    interface ConversationMessage {
        sender: "bot" | "person";
        message: string;
        timestamp: number;
    }

    interface Conversation {
        id: number;
        botId: string;
        playerId: number;
        playerName?: string;
        messages: ConversationMessage[];
        startedAt: number;
        endedAt: number;
        messageCount: number;
        createdAt: number;
    }

    interface ConversationStats {
        botId: string;
        totalConversations: number;
        oldestConversation?: number;
        newestConversation?: number;
        totalSize?: number;
    }

    let conversations: Conversation[] = [];
    let stats: ConversationStats | null = null;
    let loading = true;
    let error: string | null = null;
    let selectedConversation: Conversation | null = null;
    let cleanupOlderThanDays = 7;
    let keepRecent = 50;
    let cleanupLoading = false;

    onMount(async () => {
        await Promise.all([loadConversations(), loadStats()]);
    });

    async function loadConversations(): Promise<void> {
        try {
            loading = true;
            error = null;
            // TODO: Implement API call
            // const response = await botApiService.getBotConversations(botId);
            // conversations = response.conversations;
            conversations = []; // Placeholder
            await Promise.resolve(); // Placeholder await
        } catch (e: unknown) {
            error = (e as Error).message || "Failed to load conversations";
        } finally {
            loading = false;
        }
    }

    async function loadStats(): Promise<void> {
        try {
            // TODO: Implement API call
            // stats = await botApiService.getBotConversationStats(botId);
            stats = null; // Placeholder
            await Promise.resolve(); // Placeholder await
        } catch (e: unknown) {
            console.error("Failed to load stats:", e);
        }
    }

    async function cleanupOldConversations(): Promise<void> {
        if (!confirm(`Delete conversations older than ${cleanupOlderThanDays} days?`)) {
            return;
        }

        try {
            cleanupLoading = true;
            // TODO: Implement API call
            // const result = await botApiService.cleanupBotConversations(botId, { olderThanDays: cleanupOlderThanDays });
            // alert(`Deleted ${result.deletedCount} conversations`);
            await Promise.all([loadConversations(), loadStats()]);
        } catch (e: unknown) {
            alert(`Error: ${(e as Error).message}`);
        } finally {
            cleanupLoading = false;
        }
    }

    async function cleanupKeepRecent(): Promise<void> {
        if (!confirm(`Keep only last ${keepRecent} conversations?`)) {
            return;
        }

        try {
            cleanupLoading = true;
            // TODO: Implement API call
            // const result = await botApiService.cleanupBotConversations(botId, { keepRecent });
            // alert(`Deleted ${result.deletedCount} conversations`);
            await Promise.all([loadConversations(), loadStats()]);
        } catch (e: unknown) {
            alert(`Error: ${(e as Error).message}`);
        } finally {
            cleanupLoading = false;
        }
    }
</script>

<div class="bot-conversations-view">
    <h2>Conversations</h2>

    {#if loading}
        <p>Loading conversations...</p>
    {:else if error}
        <p class="error">Error: {error}</p>
    {:else}
        {#if stats}
            <div class="stats">
                <p>Total: {stats.totalConversations}</p>
                {#if stats.oldestConversation}
                    <p>Oldest: {new Date(stats.oldestConversation).toLocaleString()}</p>
                {/if}
                {#if stats.newestConversation}
                    <p>Newest: {new Date(stats.newestConversation).toLocaleString()}</p>
                {/if}
            </div>
        {/if}

        <div class="cleanup-controls">
            <h3>Cleanup</h3>
            <div class="cleanup-option">
                <label>
                    Delete older than:
                    <input type="number" bind:value={cleanupOlderThanDays} min="1" />
                    days
                </label>
                <button on:click={cleanupOldConversations} disabled={cleanupLoading}>
                    {cleanupLoading ? "Cleaning..." : "Delete"}
                </button>
            </div>
            <div class="cleanup-option">
                <label>
                    Keep only last:
                    <input type="number" bind:value={keepRecent} min="1" />
                    conversations
                </label>
                <button on:click={cleanupKeepRecent} disabled={cleanupLoading}>
                    {cleanupLoading ? "Cleaning..." : "Delete"}
                </button>
            </div>
        </div>

        <div class="conversations-list">
            {#if conversations.length === 0}
                <p>No conversations found.</p>
            {:else}
                {#each conversations as conversation (conversation.id)}
                    <div class="conversation-card" class:selected={selectedConversation?.id === conversation.id}>
                        <div
                            class="conversation-header"
                            on:click={() =>
                                (selectedConversation =
                                    selectedConversation?.id === conversation.id ? null : conversation)}
                        >
                            <h4>
                                Player {conversation.playerId}
                                {conversation.playerName ? `(${conversation.playerName})` : ""}
                            </h4>
                            <span class="timestamp">{new Date(conversation.startedAt).toLocaleString()}</span>
                            <span class="message-count">{conversation.messageCount} messages</span>
                        </div>

                        {#if selectedConversation?.id === conversation.id}
                            <div class="conversation-details">
                                {#each conversation.messages as message, index (index)}
                                    <div class="message" class:bot={message.sender === "bot"}>
                                        <span class="sender">{message.sender === "bot" ? "Bot" : "Person"}:</span>
                                        <span class="text">{message.message}</span>
                                        <span class="time">{new Date(message.timestamp).toLocaleTimeString()}</span>
                                    </div>
                                {/each}
                            </div>
                        {/if}
                    </div>
                {/each}
            {/if}
        </div>
    {/if}
</div>

<style>
    .bot-conversations-view {
        padding: 1rem;
    }

    .stats {
        display: flex;
        gap: 1rem;
        margin: 1rem 0;
        padding: 0.5rem;
        background: #f5f5f5;
        border-radius: 4px;
    }

    .cleanup-controls {
        border: 1px solid #ccc;
        border-radius: 4px;
        padding: 1rem;
        margin: 1rem 0;
    }

    .cleanup-option {
        display: flex;
        align-items: center;
        gap: 1rem;
        margin: 0.5rem 0;
    }

    .conversations-list {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        margin-top: 1rem;
    }

    .conversation-card {
        border: 1px solid #ccc;
        border-radius: 4px;
        overflow: hidden;
    }

    .conversation-card.selected {
        border-color: #4caf50;
    }

    .conversation-header {
        padding: 1rem;
        cursor: pointer;
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: #f9f9f9;
    }

    .conversation-header:hover {
        background: #f0f0f0;
    }

    .conversation-details {
        padding: 1rem;
        max-height: 400px;
        overflow-y: auto;
    }

    .message {
        margin: 0.5rem 0;
        padding: 0.5rem;
        border-radius: 4px;
    }

    .message.bot {
        background: #e3f2fd;
    }

    .message:not(.bot) {
        background: #f5f5f5;
    }

    .sender {
        font-weight: bold;
        margin-right: 0.5rem;
    }

    .time {
        float: right;
        color: #666;
        font-size: 0.9em;
    }

    .error {
        color: red;
    }
</style>
