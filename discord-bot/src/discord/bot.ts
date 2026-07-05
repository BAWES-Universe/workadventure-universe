import axios, { AxiosError } from "axios";
import type { DiscordMessagePayload } from "../types";

export class DiscordBot {
    private botToken: string;
    private eventChannelId: string;
    private botEventChannelId: string;
    private statsChannelId: string;
    private baseUrl = "https://discord.com/api/v10";

    constructor(botToken: string, eventChannelId: string, botEventChannelId: string, statsChannelId: string) {
        this.botToken = botToken;
        this.eventChannelId = eventChannelId;
        this.botEventChannelId = botEventChannelId;
        this.statsChannelId = statsChannelId;
    }

    /**
     * Send a message to the event channel (real-time join/leave events).
     * Uses eventChannelId by default, or botEventChannelId if isBotEvent is true.
     */
    async sendEventMessage(payload: DiscordMessagePayload, isBotEvent: boolean = false): Promise<boolean> {
        const channelId = isBotEvent ? this.botEventChannelId : this.eventChannelId;
        try {
            await axios.post(
                `${this.baseUrl}/channels/${channelId}/messages`,
                payload,
                {
                    headers: {
                        Authorization: `Bot ${this.botToken}`,
                        "Content-Type": "application/json",
                    },
                }
            );
            return true;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                console.error("Failed to send Discord event message:", error.response?.status, error.response?.statusText);
            } else {
                console.error("Failed to send Discord event message:", error);
            }
            return false;
        }
    }

    /**
     * Clear all messages in the stats channel
     */
    async clearChannel(channelId: string): Promise<number> {
        let deletedCount = 0;
        let hasMore = true;

        try {
            while (hasMore) {
                // Fetch messages in batches of 100
                const response = await axios.get(
                    `${this.baseUrl}/channels/${channelId}/messages?limit=100`,
                    {
                        headers: {
                            Authorization: `Bot ${this.botToken}`,
                        },
                    }
                );

                const messages: Array<{ id: string }> = response.data;

                if (messages.length === 0) {
                    hasMore = false;
                    break;
                }

                // Try bulk delete first (only works for messages < 14 days old)
                if (messages.length > 1) {
                    const messageIds = messages.map((m) => m.id);
                    try {
                        const bulkResponse = await axios.post(
                            `${this.baseUrl}/channels/${channelId}/messages/bulk-delete`,
                            { messages: messageIds },
                            {
                                headers: {
                                    Authorization: `Bot ${this.botToken}`,
                                    "Content-Type": "application/json",
                                },
                            }
                        );

                        if (bulkResponse.status === 204) {
                            deletedCount += messageIds.length;
                            hasMore = messages.length === 100;
                            continue;
                        }
                    } catch (bulkError) {
                        // Bulk delete failed, fall through to individual delete
                    }
                }

                // Delete messages individually (fallback for old messages or if bulk delete fails)
                for (const message of messages) {
                    try {
                        await axios.delete(
                            `${this.baseUrl}/channels/${channelId}/messages/${message.id}`,
                            {
                                headers: {
                                    Authorization: `Bot ${this.botToken}`,
                                },
                            }
                        );
                        deletedCount++;
                    } catch (deleteError) {
                        if (axios.isAxiosError(deleteError)) {
                            const axiosError = deleteError as AxiosError;
                            if (axiosError.response?.status === 404) {
                                // Message already deleted, continue
                            } else if (axiosError.response?.status === 403) {
                                console.warn(`Cannot delete message ${message.id}: insufficient permissions`);
                            } else {
                                console.warn(`Failed to delete message ${message.id}: ${axiosError.response?.status}`);
                            }
                        }
                    }

                    // Rate limit: Discord allows 5 requests per second, add delay
                    await new Promise((resolve) => setTimeout(resolve, 250));
                }

                hasMore = messages.length === 100;
            }

            if (deletedCount > 0) {
                console.log(`Cleared ${deletedCount} messages from Discord stats channel`);
            }
            return deletedCount;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                const axiosError = error as AxiosError;
                if (axiosError.response?.status === 404) {
                    console.error("Discord channel not found");
                } else if (axiosError.response?.status === 403) {
                    console.error("Discord bot lacks permissions to read/delete messages");
                } else {
                    console.error("Error clearing Discord channel:", axiosError.message);
                }
            } else {
                console.error("Error clearing Discord channel:", error);
            }
            return deletedCount;
        }
    }

    /**
     * Send a stats report to the stats channel (clears channel first, then sends multiple messages)
     */
    async sendStatsReport(summaryEmbed: DiscordMessagePayload, roomEmbeds: DiscordMessagePayload[]): Promise<boolean> {
        try {
            // Clear all messages first
            await this.clearChannel(this.statsChannelId);

            // Send summary message first
            await axios.post(
                `${this.baseUrl}/channels/${this.statsChannelId}/messages`,
                summaryEmbed,
                {
                    headers: {
                        Authorization: `Bot ${this.botToken}`,
                        "Content-Type": "application/json",
                    },
                }
            );

            // Send room messages with delays to avoid rate limits
            for (const roomEmbed of roomEmbeds) {
                await axios.post(
                    `${this.baseUrl}/channels/${this.statsChannelId}/messages`,
                    roomEmbed,
                    {
                        headers: {
                            Authorization: `Bot ${this.botToken}`,
                            "Content-Type": "application/json",
                        },
                    }
                );
                // Small delay between messages (Discord allows 5 requests per second)
                await new Promise((resolve) => setTimeout(resolve, 300));
            }

            return true;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                console.error("Failed to send Discord stats report:", error.response?.status, error.response?.statusText);
            } else {
                console.error("Failed to send Discord stats report:", error);
            }
            return false;
        }
    }
}

