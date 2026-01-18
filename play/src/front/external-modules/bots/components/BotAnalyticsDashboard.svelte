<!--
  BotAnalyticsDashboard - Display conversation metrics and analytics
  
  Features:
  - Display conversation metrics
  - Show purpose distribution charts
  - Display usage patterns
  - Compare metrics over time
  
  TODO: Implement this component
  - Fetch analytics from API: GET /api/bots/:botId/analytics
  - Display metrics charts (use a charting library like Chart.js)
  - Show purpose distribution (pie/bar chart)
  - Display usage patterns (time-based charts)
  - Allow time range selection
-->

<script lang="ts">
    import { onMount } from "svelte";
    // import { botApiService } from '../services/BotApiService'; // TODO: Uncomment when implementing API calls

    export let botId: string;

    interface Analytics {
        botId: string;
        timeRange: {
            start: number;
            end: number;
        };
        totalConversations: number;
        totalMessages: number;
        averageConversationLength: number;
        purposeDistribution: Record<string, number>;
        averageResponseTime: number;
        averagePersonalityCompliance: number;
        usagePatterns: {
            peakHours: number[];
            averageSessionDuration: number;
        };
    }

    let analytics: Analytics | null = null;
    let loading = true;
    let error: string | null = null;

    onMount(async () => {
        await loadAnalytics();
    });

    async function loadAnalytics(): Promise<void> {
        try {
            loading = true;
            error = null;
            // TODO: Implement API call
            // const response = await botApiService.getBotAnalytics(botId);
            // analytics = response;
            analytics = null; // Placeholder
            await Promise.resolve(); // Placeholder await
        } catch (e: unknown) {
            error = (e as Error).message || "Failed to load analytics";
        } finally {
            loading = false;
        }
    }
</script>

<div class="bot-analytics-dashboard">
    <h2>Bot Analytics</h2>

    {#if loading}
        <p>Loading analytics...</p>
    {:else if error}
        <p class="error">Error: {error}</p>
    {:else if !analytics}
        <p>No analytics data available.</p>
    {:else}
        <div class="analytics-grid">
            <div class="metric-card">
                <h3>Total Conversations</h3>
                <p class="metric-value">{analytics.totalConversations}</p>
            </div>

            <div class="metric-card">
                <h3>Total Messages</h3>
                <p class="metric-value">{analytics.totalMessages}</p>
            </div>

            <div class="metric-card">
                <h3>Avg Conversation Length</h3>
                <p class="metric-value">{analytics.averageConversationLength.toFixed(1)}</p>
            </div>

            <div class="metric-card">
                <h3>Avg Response Time</h3>
                <p class="metric-value">{analytics.averageResponseTime.toFixed(0)}ms</p>
            </div>

            <div class="metric-card">
                <h3>Personality Compliance</h3>
                <p class="metric-value">{(analytics.averagePersonalityCompliance * 100).toFixed(1)}%</p>
            </div>

            <div class="chart-card">
                <h3>Purpose Distribution</h3>
                <!-- TODO: Add chart component -->
                <div class="purpose-list">
                    {#each Object.entries(analytics.purposeDistribution) as [purpose, count] (purpose)}
                        <div class="purpose-item">
                            <span>{purpose}:</span>
                            <span>{count}</span>
                        </div>
                    {/each}
                </div>
            </div>
        </div>
    {/if}
</div>

<style>
    .bot-analytics-dashboard {
        padding: 1rem;
    }

    .analytics-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 1rem;
        margin-top: 1rem;
    }

    .metric-card {
        border: 1px solid #ccc;
        border-radius: 4px;
        padding: 1rem;
        text-align: center;
    }

    .metric-value {
        font-size: 2rem;
        font-weight: bold;
        margin: 0.5rem 0;
    }

    .chart-card {
        grid-column: 1 / -1;
        border: 1px solid #ccc;
        border-radius: 4px;
        padding: 1rem;
    }

    .purpose-list {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .purpose-item {
        display: flex;
        justify-content: space-between;
    }

    .error {
        color: red;
    }
</style>
