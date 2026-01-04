// Bot data types for the editor

export interface BotData {
    botId?: string;
    name?: string;
    description?: string;
    position?: {
        x: number;
        y: number;
    };
    characterTexture?: string;
    characterTextureIds?: string[];
    behaviorType?: "idle" | "patrol" | "social";
    behaviorConfig?: {
        conversationRadius?: number;
        wanderRadius?: number;
        wanderCenter?: { x: number; y: number };
        assignedSpace?: {
            center?: { x: number; y: number };
            radius?: number;
        };
        waypoints?: Array<{ x: number; y: number }>;
        minTimeBetweenConversations?: number;
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
