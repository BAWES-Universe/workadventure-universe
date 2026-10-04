import { botApiService } from "../../external-modules/bots/services/BotApiService";
import { BotStatusCache } from "./BotStatusCache";

/** Every bot state the game shows comes from this one cache. */
export const botStatusCache = new BotStatusCache((ids) => botApiService.getDmStatus(ids));
