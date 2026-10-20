// Bot chat telemetry of the bot whose page is open: what Orbit says about it, and the switch's changes. A change shows
// at once and is saved; if Orbit refuses it the page goes back to what Orbit holds and says why (nothing fails silently).
import { get, writable } from "svelte/store";
import LL from "../../../../i18n/i18n-svelte";
import { botApiService, type BotTelemetry } from "../services/BotApiService";

export interface BotTelemetryState {
    botId: string;
    status: "loading" | "ready" | "failed";
    data?: BotTelemetry;
    /** Why the last change was not saved, in a line for the person. Cleared by the next change that is. */
    saveError?: string;
}

export const botTelemetryStore = writable<BotTelemetryState | undefined>(undefined);

/** Only the newest request of a bot may set the page: an older answer arriving late would undo a newer change. */
let latest = 0;

function update(botId: string, change: (state: BotTelemetryState) => BotTelemetryState) {
    botTelemetryStore.update((state) => (state && state.botId === botId ? change(state) : state));
}

function lineOf(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
}

export async function loadBotTelemetry(botId: string): Promise<void> {
    const held = get(botTelemetryStore);
    if (!held || held.botId !== botId || !held.data) botTelemetryStore.set({ botId, status: "loading" });
    const mine = ++latest;
    try {
        const data = await botApiService.getBotTelemetry(botId);
        if (mine === latest) update(botId, () => ({ botId, status: "ready", data }));
    } catch (error) {
        console.error("[BotTelemetryStore] Failed to load bot chat telemetry:", error);
        if (mine !== latest) return;
        update(botId, (state) =>
            state.data
                ? { ...state, saveError: lineOf(error, get(LL).mapEditor.edit.bots.page.telemetry.loadFailed()) }
                : { botId, status: "failed" }
        );
    }
}

/** Turn the switch on or off for this bot. */
export async function setBotTelemetry(botId: string, on: boolean): Promise<void> {
    const before = get(botTelemetryStore);
    if (!before || before.botId !== botId || !before.data || before.data.universeHides) return;
    const previous = before.data;
    const mine = ++latest;
    update(botId, (state) => ({ ...state, data: { ...previous, on }, saveError: undefined }));
    try {
        const data = await botApiService.saveBotTelemetry(botId, on);
        if (mine === latest) update(botId, () => ({ botId, status: "ready", data }));
    } catch (error) {
        console.error("[BotTelemetryStore] Failed to save bot chat telemetry:", error);
        if (mine !== latest) return;
        update(botId, (state) => ({
            ...state,
            data: previous,
            saveError: lineOf(error, get(LL).mapEditor.edit.bots.page.telemetry.saveFailed()),
        }));
    }
}

export function clearBotTelemetry(): void {
    latest++;
    botTelemetryStore.set(undefined);
}
