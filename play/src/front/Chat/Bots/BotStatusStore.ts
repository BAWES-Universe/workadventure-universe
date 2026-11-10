import { botApiService } from "../../external-modules/bots/services/BotApiService";
import { localUserStore } from "../../Connection/LocalUserStore";
import { BotStatusCache } from "./BotStatusCache";
import { BotDmAccessCache } from "./BotDmAccess";

/** Every bot state the game shows comes from this one cache. */
export const botStatusCache = new BotStatusCache((ids) => botApiService.getDmStatus(ids));

/** Whether you may message a bot: its Message button shows only on a yes. */
export const botDmAccessCache = new BotDmAccessCache(
    async (botId) => (await botApiService.getBotAccess(botId, "dm", localUserStore.getLocalUser()?.uuid)).allowed
);

/** Whether a bot hears voice notes: the mic shows in its chat only on a yes (asked and kept the same way as the Message button). */
export const botHearsCache = new BotDmAccessCache((botId) => botApiService.getBotHears(botId));
