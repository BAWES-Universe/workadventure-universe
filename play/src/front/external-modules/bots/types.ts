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
    /** The bot's own model on its own AI key (null: the key's check model). Undefined: not known here. */
    aiModel?: string | null;
    toolTimeoutSeconds?: number | null; // "Patience": how long the bot waits for a tool, null = the server's 90 s
    /** "Longest reply" in tokens, lower than its key's (Orbit #666); null follows the key. */
    maxReplyTokens?: number | null;
    /** "Steps in one reply", lower than its key's (Orbit #666); null follows the key. */
    maxSteps?: number | null;
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
/** One model of a key that the lend here allows, with what the provider says about it (left out when it said nothing). */
export interface KeyModelOption {
    id: string;
    tools?: boolean;
    vision?: boolean;
    /** The longest reply it can write, in tokens (Orbit #673). */
    output?: number;
}

/** A key's (or Universe AI's) longest reply in tokens and steps in one reply (Orbit #666): a bot on it can lower them only. */
export interface BotLimitCeiling {
    reply: number;
    steps: number;
}

export interface BotAiOptions {
    /** The bot's current ref ("universe-ai", a provider id, a key id, or null). */
    current: string | null;
    /** The bot's own model on its key (null: the key's check model, or not on a key). Missing on an older Orbit. */
    currentModel?: string | null;
    universeAi: {
        available: boolean;
        model?: string | null;
        supportsVision?: boolean | null;
        limits?: BotLimitCeiling;
    };
    maker: { id: string; name: string | null } | null;
    viewerIsMaker: boolean;
    keys: Array<{
        id: string;
        name: string;
        kind: string | null;
        kindLabel: string;
        /** The provider's logo file in /static/ai-providers (without .svg); `plainIcon` says what is drawn without one. Absent from an older Orbit. */
        logo?: string | null;
        plainIcon?: "plug" | "chip" | null;
        group: "own-computer" | "hosted" | null;
        universeName: string;
        status: "working" | "down";
        ifDown: "universe-ai" | "stop";
        /** The key's check model: what a bot on it replies with until it picks its own. */
        model?: string | null;
        /** For the Vision row (missing from an older Orbit): whether the key's model sees, and the models with Vision it could look at images with. */
        supportsVision?: boolean | null;
        visionModels?: string[];
        /** The longest reply the check model can write, when its provider says (Orbit #673). */
        output?: number | null;
        /** The models the lend here allows (null when the provider's list could not be loaded). Missing on an older Orbit. */
        models?: KeyModelOption[] | null;
        /** The lend here allows only some of the key's models. */
        limited?: boolean;
        /** Its longest reply and steps; a bot on it can only lower them. Missing on an older Orbit. */
        limits?: BotLimitCeiling;
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
        logo?: string | null;
        plainIcon?: "plug" | "chip" | null;
        limits?: BotLimitCeiling;
        /** The model the bot replies with, and the longest reply it can write when its provider says (Orbit #673). */
        model?: string | null;
        output?: number | null;
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
