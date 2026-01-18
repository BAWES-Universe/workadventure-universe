<!--
  BotEmotionsView - Display bot emotions for all players
  
  Features:
  - Display bot emotions for all players
  - Show emotion history over time
  - Link to recent conversations
  - Verify emotions match conversations
  
  TODO: Implement this component
  - Fetch emotions from API: GET /api/bots/:botId/emotions
  - Display emotion values (anger, happiness, trust, familiarity)
  - Show emotion history chart (use a charting library)
  - Link to conversations for each player
  - Allow manual emotion adjustment (admin only)
-->

<script lang="ts">
    import { onMount } from "svelte";
    // import { botApiService } from '../services/BotApiService'; // TODO: Uncomment when implementing API calls

    export let botId: string;

    interface EmotionalState {
        botEmotion: {
            anger: number;
            happiness: number;
            trust: number;
            familiarity: number;
        };
        personEmotion: {
            anger: number;
            happiness: number;
            trust: number;
        };
        lastEmotionUpdate: number;
    }

    interface PlayerEmotions {
        playerId: number;
        playerName?: string;
        emotions: EmotionalState;
    }

    let emotions: PlayerEmotions[] = [];
    let loading = true;
    let error: string | null = null;

    onMount(async () => {
        await loadEmotions();
    });

    async function loadEmotions(): Promise<void> {
        try {
            loading = true;
            error = null;
            // TODO: Implement API call
            // const response = await botApiService.getBotEmotions(botId);
            // emotions = response;
            emotions = []; // Placeholder
            await Promise.resolve(); // Placeholder await
        } catch (e: unknown) {
            error = (e as Error).message || "Failed to load emotions";
        } finally {
            loading = false;
        }
    }
</script>

<div class="bot-emotions-view">
    <h2>Bot Emotions</h2>

    {#if loading}
        <p>Loading emotions...</p>
    {:else if error}
        <p class="error">Error: {error}</p>
    {:else if emotions.length === 0}
        <p>No emotions data available.</p>
    {:else}
        <div class="emotions-list">
            {#each emotions as playerEmotions (playerEmotions.playerId)}
                <div class="emotion-card">
                    <h3>
                        Player {playerEmotions.playerId}
                        {playerEmotions.playerName ? `(${playerEmotions.playerName})` : ""}
                    </h3>

                    <div class="emotion-section">
                        <h4>Bot's Emotions (toward player)</h4>
                        <div class="emotion-bar">
                            <span>Anger:</span>
                            <div class="bar">
                                <div class="fill" style="width: {playerEmotions.emotions.botEmotion.anger}%" />
                            </div>
                            <span>{playerEmotions.emotions.botEmotion.anger}</span>
                        </div>
                        <div class="emotion-bar">
                            <span>Happiness:</span>
                            <div class="bar">
                                <div class="fill" style="width: {playerEmotions.emotions.botEmotion.happiness}%" />
                            </div>
                            <span>{playerEmotions.emotions.botEmotion.happiness}</span>
                        </div>
                        <div class="emotion-bar">
                            <span>Trust:</span>
                            <div class="bar">
                                <div class="fill" style="width: {playerEmotions.emotions.botEmotion.trust}%" />
                            </div>
                            <span>{playerEmotions.emotions.botEmotion.trust}</span>
                        </div>
                        <div class="emotion-bar">
                            <span>Familiarity:</span>
                            <div class="bar">
                                <div class="fill" style="width: {playerEmotions.emotions.botEmotion.familiarity}%" />
                            </div>
                            <span>{playerEmotions.emotions.botEmotion.familiarity}</span>
                        </div>
                    </div>

                    <div class="emotion-section">
                        <h4>Player's Emotions (toward bot)</h4>
                        <div class="emotion-bar">
                            <span>Anger:</span>
                            <div class="bar">
                                <div class="fill" style="width: {playerEmotions.emotions.personEmotion.anger}%" />
                            </div>
                            <span>{playerEmotions.emotions.personEmotion.anger}</span>
                        </div>
                        <div class="emotion-bar">
                            <span>Happiness:</span>
                            <div class="bar">
                                <div class="fill" style="width: {playerEmotions.emotions.personEmotion.happiness}%" />
                            </div>
                            <span>{playerEmotions.emotions.personEmotion.happiness}</span>
                        </div>
                        <div class="emotion-bar">
                            <span>Trust:</span>
                            <div class="bar">
                                <div class="fill" style="width: {playerEmotions.emotions.personEmotion.trust}%" />
                            </div>
                            <span>{playerEmotions.emotions.personEmotion.trust}</span>
                        </div>
                    </div>

                    <div class="actions">
                        <button
                            on:click={() => {
                                /* TODO: Link to conversations */
                            }}
                        >
                            View Conversations
                        </button>
                    </div>
                </div>
            {/each}
        </div>
    {/if}
</div>

<style>
    .bot-emotions-view {
        padding: 1rem;
    }

    .emotions-list {
        display: flex;
        flex-direction: column;
        gap: 1rem;
    }

    .emotion-card {
        border: 1px solid #ccc;
        border-radius: 4px;
        padding: 1rem;
    }

    .emotion-section {
        margin: 1rem 0;
    }

    .emotion-bar {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin: 0.5rem 0;
    }

    .bar {
        flex: 1;
        height: 20px;
        background: #eee;
        border-radius: 4px;
        overflow: hidden;
    }

    .fill {
        height: 100%;
        background: #4caf50;
    }

    .error {
        color: red;
    }
</style>
