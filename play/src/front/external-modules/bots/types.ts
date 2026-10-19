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
        showToolCalls?: boolean; // Show a 🔍 bubble when the bot uses an outside (MCP) tool; off when missing
        vision?: VisionPick | null; // Where its images go (the Vision row); nothing = the owner picked nothing
        [key: string]: unknown;
    };
    chatInstructions?: string;
    aiProviderRef?: string; // Reference to AI provider config in Admin API
    toolTimeoutSeconds?: number | null; // "Patience": how long the bot waits for a tool, null = the server's 90 s
    companionTextureId?: string | null; // The companion (pet) that walks with it, a companion texture id; null = none
    enabled?: boolean; // Whether bot is active
    createdAt?: string;
    updatedAt?: string;
    createdBy?: BotUser | null;
    updatedBy?: BotUser | null;
    [key: string]: unknown;
}

/**
 * Where a bot's images go (the Vision row, #374). The bot's own model still writes every reply; this says what looks at the
 * images people send: its own model, a model with Vision on one of the maker's keys, or Universe AI.
 */
export type VisionPick =
    | { choice: "this" }
    | { choice: "universe-ai" }
    | { choice: "another"; keyId: string; model: string };

/**
 * What the bot page offers under "Runs on" for one bot (Orbit GET /api/me/bot-ai, #374). Nobody is shown the server's
 * provider list: the choices are Universe AI and the viewer's own keys lent to this bot's universe. A key that isn't
 * the viewer's is shown only as what the bot is on now. A super admin also gets `providers`, to pin a bot to one.
 */
export interface BotAiOptions {
    /** The bot's current ref ("universe-ai", a provider id, a key id, or null). */
    current: string | null;
    universeAi: { available: boolean; model?: string | null; supportsVision?: boolean | null };
    maker: { id: string; name: string | null } | null;
    viewerIsMaker: boolean;
    keys: Array<{
        id: string;
        name: string;
        kind: string | null;
        kindLabel: string;
        group: "own-computer" | "hosted" | null;
        universeName: string;
        status: "working" | "down";
        ifDown: "universe-ai" | "stop";
        /** For the Vision row (missing from an older Orbit): the model the key runs, whether it sees, and the models with Vision it could look at images with. */
        model?: string | null;
        supportsVision?: boolean | null;
        visionModels?: string[];
    }>;
    currentKey: {
        id: string;
        name: string;
        ownerName: string | null;
        mine: boolean;
        status: "working" | "down";
        ifDown: "universe-ai" | "stop";
        group?: "own-computer" | "hosted" | null;
        model?: string | null;
        supportsVision?: boolean | null;
        visionModels?: string[];
    } | null;
    /** What is saved for the bot's images, and for "Another model" the key picked and why it can't be used now (null = it can). Missing from an older Orbit. */
    vision?: {
        saved: VisionPick | null;
        savedKey: {
            name: string;
            problem: "gone" | "not-maker" | "not-lent" | "no-access" | "no-room" | "no-model" | "down" | null;
        } | null;
    };
    providers: Array<{ id: string; name: string; type: string; model: string | null; enabled: boolean }> | null;
}
