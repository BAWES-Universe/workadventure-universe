/**
 * Turning a bot on or off: the switch flips right away, the change is saved, and the bot is spawned or despawned to
 * match. A failed save flips the switch back and throws, for the caller to show.
 */
import type { BotData } from "../types";
import { upsertBot } from "../stores/BotEditorStore";
import { botApiService } from "./BotApiService";

export async function setBotEnabled(bot: BotData, enabled: boolean): Promise<void> {
    const originalEnabled = bot.enabled;
    upsertBot({ ...bot, enabled });

    try {
        const updatedBot = await botApiService.updateBot(bot.id, { enabled });

        // Ensure we always have a valid ID (fallback to original bot.id if API doesn't return it)
        const botId = updatedBot.id || bot.id;
        if (!botId) {
            throw new Error("Bot ID is missing");
        }

        const textureId = typeof updatedBot.characterTextureId === "string" ? updatedBot.characterTextureId : "";
        upsertBot({
            ...bot,
            id: botId,
            botId: botId,
            name: updatedBot.name || bot.name,
            description: typeof updatedBot.description === "string" ? updatedBot.description : bot.description,
            characterTexture: textureId || bot.characterTexture,
            characterTextureIds: textureId ? [textureId] : bot.characterTextureIds || [],
            behaviorType: (updatedBot.behaviorType as "idle" | "patrol" | "social") || bot.behaviorType,
            enabled: updatedBot.enabled ?? enabled, // Use API response, fallback to requested state
            behaviorConfig: updatedBot.behaviorConfig || bot.behaviorConfig,
            chatInstructions: updatedBot.chatInstructions || bot.chatInstructions || "",
            aiProviderRef: updatedBot.aiProviderRef || bot.aiProviderRef || undefined,
            createdAt: updatedBot.createdAt || bot.createdAt || new Date().toISOString(),
            updatedAt: updatedBot.updatedAt || new Date().toISOString(),
            createdBy: updatedBot.createdBy || bot.createdBy || null,
            updatedBy: updatedBot.updatedBy || bot.updatedBy || null,
        });
    } catch (e) {
        upsertBot({ ...bot, enabled: originalEnabled });
        throw e;
    }

    // The bot is saved on or off even when spawning or despawning it fails
    try {
        if (enabled) {
            await botApiService.spawnBot(bot.id);
        } else {
            await botApiService.despawnBot(bot.id);
        }
    } catch (e) {
        console.warn(`[setBotEnabled] Failed to ${enabled ? "spawn" : "despawn"} bot ${bot.id}:`, e);
    }
}
