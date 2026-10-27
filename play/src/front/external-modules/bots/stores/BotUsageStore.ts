// The usage of the bot whose page is open (Orbit #491): read when the page opens and again when the range changes. The
// Usage group and its three screens all show this one answer.
import { writable } from "svelte/store";
import { botApiService } from "../services/BotApiService";
import { viewerTimeZone, type BotUsage, type UsageRange } from "../usageModel";

export interface BotUsageState {
    botId: string;
    range: UsageRange;
    /** hidden: Orbit says this person doesn't manage the bot, so there is no Usage to show them */
    status: "loading" | "ready" | "failed" | "hidden";
    data?: BotUsage;
}

export const botUsageStore = writable<BotUsageState | undefined>(undefined);

/** Only the newest request may set the page: an older answer arriving late would show the wrong bot or range. */
let latest = 0;

export async function loadBotUsage(botId: string, range: UsageRange): Promise<void> {
    const mine = ++latest;
    // Keep what is shown while the next range loads, so the page doesn't jump
    botUsageStore.update((state) =>
        state && state.botId === botId ? { ...state, range, status: "loading" } : { botId, range, status: "loading" }
    );
    try {
        const data = await botApiService.getBotUsage(botId, range, viewerTimeZone());
        if (mine === latest) botUsageStore.set({ botId, range, status: "ready", data });
    } catch (error) {
        if (mine !== latest) return;
        if ((error as { status?: number })?.status === 404) {
            botUsageStore.set({ botId, range, status: "hidden" });
            return;
        }
        botUsageStore.update((state) =>
            state && state.botId === botId ? { ...state, range, status: "failed" } : { botId, range, status: "failed" }
        );
    }
}
