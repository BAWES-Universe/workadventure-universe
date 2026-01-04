// Bot data types for the editor

export interface BotData {
    botId?: string;
    name?: string;
    description?: string;
    characterTexture?: string;
    characterTextureIds?: string[];
    behaviorType?: "idle" | "patrol" | "social";
    behaviorConfig?: {
        // Assigned space defines where the bot operates (center + radius)
        // For idle bots: radius=0 means they won't move
        // For social/patrol bots: radius defines the operational area
        assignedSpace: {
            center: { x: number; y: number };
            radius: number;
        };
        // Behavior-specific configs
        conversationRadius?: number; // For social bots: detection range for players
        waypoints?: Array<{ x: number; y: number }>; // For patrol bots
        minTimeBetweenConversations?: number; // For social bots
        [key: string]: unknown;
    };
    chatInstructions?: string;
    movementInstructions?: string;
    aiProviderRef?: string; // Reference to AI provider config in Admin API
    enabled?: boolean; // Whether bot is active
    createdAt?: string;
    updatedAt?: string;
    [key: string]: unknown;
}
