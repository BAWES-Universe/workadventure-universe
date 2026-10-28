import type { BotData } from "./types";

/** What the bot server answers a bot save with: the bot as Orbit saved it, with Orbit's own field names. */
type SavedBot = BotData & { characterTextureId?: unknown };

/**
 * The page's record of a bot after a save from its page (texture, companion, name...). What that save didn't send keeps
 * the page's value: the bot's own model, and its Patience and reply limits. Without them the page's auto-save would read
 * the limits as cleared and save them as null (CodeRabbit on #1524).
 */
export function botDataFromSave(updatedBot: SavedBot, sent: BotData): BotData {
    const textureId = typeof updatedBot.characterTextureId === "string" ? updatedBot.characterTextureId : "";
    // Ensure behaviorType is never undefined
    const behaviorConfig = updatedBot.behaviorConfig as BotData["behaviorConfig"] | undefined;
    const responseBehaviorType =
        (updatedBot.behaviorType as "idle" | "patrol" | "social") || behaviorConfig?.behaviorType || "idle";

    return {
        id: updatedBot.id,
        botId: updatedBot.id,
        name: updatedBot.name,
        description: typeof updatedBot.description === "string" ? updatedBot.description : undefined,
        characterTexture: textureId,
        characterTextureIds: textureId ? [textureId] : [],
        companionTextureId: typeof updatedBot.companionTextureId === "string" ? updatedBot.companionTextureId : null,
        behaviorType: responseBehaviorType, // Guaranteed to be set
        enabled: updatedBot.enabled ?? true,
        behaviorConfig: updatedBot.behaviorConfig || {
            behaviorType: responseBehaviorType,
            assignedSpace: { center: { x: 0, y: 0 }, radius: 0 },
        },
        aiProviderRef: updatedBot.aiProviderRef,
        aiModel: sent.aiModel,
        chatInstructions: updatedBot.chatInstructions || "",
        toolTimeoutSeconds: sent.toolTimeoutSeconds ?? null,
        maxReplyTokens: sent.maxReplyTokens ?? null,
        maxSteps: sent.maxSteps ?? null,
        createdAt: updatedBot.createdAt || new Date().toISOString(),
        updatedAt: updatedBot.updatedAt || new Date().toISOString(),
        createdBy: updatedBot.createdBy || null,
        updatedBy: updatedBot.updatedBy || null,
    };
}
