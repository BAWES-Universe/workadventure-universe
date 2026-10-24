/**
 * Turning a bot on or off: the switch flips right away, the change is saved, and the bot is spawned or despawned to
 * match. A failed save flips the switch back and throws, for the caller to show.
 */
import { get } from "svelte/store";
import type { BotData } from "../types";
import { botPreviewsStore, upsertBot } from "../stores/BotEditorStore";
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

        // Only the on/off state comes from this answer. The rest is taken from the store as it is now, not from the
        // answer or from when the switch was pressed: an edit made just before (a provider picked, instructions
        // typed) may still be waiting to save, and the answer still has the old values.
        const latest = get(botPreviewsStore).get(botId) ?? bot;
        upsertBot({
            ...latest,
            id: botId,
            botId: botId,
            enabled: updatedBot.enabled ?? enabled, // Use API response, fallback to requested state
            updatedAt: updatedBot.updatedAt || new Date().toISOString(),
            updatedBy: updatedBot.updatedBy || latest.updatedBy || null,
        });
    } catch (e) {
        upsertBot({ ...(get(botPreviewsStore).get(bot.id) ?? bot), enabled: originalEnabled });
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
