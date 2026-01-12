// Bot data types for the editor

export interface BotUser {
    id: string;
    name: string | null;
    email: string | null;
}

export interface BotData {
    id: string; // Unique identifier (required for stores/phaser)
    botId?: string; // Legacy/API identifier
    name?: string;
    description?: string;
    characterTexture?: string;
    characterTextureIds?: string[];
    behaviorType?: "idle" | "patrol" | "social";
    behaviorConfig: {
        // Behavior type (redundant with behaviorType for flexibility)
        behaviorType?: "idle" | "patrol" | "social";
        // Assigned space defines where the bot operates (center + radius)
        // For idle bots: radius=0 means they won't move
        // For social/patrol bots: radius defines the operational area
        assignedSpace: {
            center: { x: number; y: number };
            radius: number;
        };
        // Behavior-specific configs
        conversationRadius?: number; // For social bots: detection range for players
        patrolWaypoints?: Array<{ x: number; y: number }>; // For patrol bots
        minTimeBetweenConversations?: number; // For social bots
        [key: string]: unknown;
    };
    chatInstructions?: string;
    movementInstructions?: string;
    aiProviderRef?: string; // Reference to AI provider config in Admin API
    enabled?: boolean; // Whether bot is active
    createdAt?: string;
    updatedAt?: string;
    createdBy?: BotUser | null;
    updatedBy?: BotUser | null;
    [key: string]: unknown;
}
