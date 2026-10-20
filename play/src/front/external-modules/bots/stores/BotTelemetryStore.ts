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

/**
 * A new bot was made but its telemetry "off" was not saved: said until the person sets it, dismisses it or moves to
 * another bot. Kept here and not in the editor, so it still shows if the editor was closed while the save failed.
 */
export const botTelemetryNoticeStore = writable<{ botId: string; text: string } | null>(null);

/** Only the newest request of a bot may set the page: an older answer arriving late would undo a newer change. */
const latest = new Map<string, number>();
function ticket(botId: string): number {
    const next = (latest.get(botId) ?? 0) + 1;
    latest.set(botId, next);
    return next;
}

function update(botId: string, change: (state: BotTelemetryState) => BotTelemetryState) {
    botTelemetryStore.update((state) => (state && state.botId === botId ? change(state) : state));
}

function lineOf(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Changes to one bot are saved one after the other, and a refused one goes back to what Orbit last confirmed, never to
 * a state the page only showed. So two quick taps that both fail leave the switch where Orbit holds it.
 */
const tails = new Map<string, Promise<unknown>>();
const confirmed = new Map<string, BotTelemetry>();

export async function loadBotTelemetry(botId: string): Promise<void> {
    const held = get(botTelemetryStore);
    if (!held || held.botId !== botId || !held.data) botTelemetryStore.set({ botId, status: "loading" });
    // The read takes its place before it waits, so a change made while it waits is newer than it and its answer is
    // dropped. It still waits for the changes already on their way, so it cannot overtake one.
    const mine = ticket(botId);
    await (tails.get(botId) ?? Promise.resolve()).catch(() => undefined);
    try {
        const data = await botApiService.getBotTelemetry(botId);
        if (mine === latest.get(botId)) update(botId, () => ({ botId, status: "ready", data }));
    } catch (error) {
        console.error("[BotTelemetryStore] Failed to load bot chat telemetry:", error);
        if (mine !== latest.get(botId)) return;
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
    if (!confirmed.has(botId)) confirmed.set(botId, before.data);
    ticket(botId);
    update(botId, (state) => ({ ...state, data: state.data && { ...state.data, on }, saveError: undefined }));
    const run = (tails.get(botId) ?? Promise.resolve()).then(async () => {
        try {
            const data = await botApiService.saveBotTelemetry(botId, on);
            confirmed.set(botId, data);
            // Only the last change in the line sets the page: an earlier answer must not undo a newer tap
            if (tails.get(botId) === run) update(botId, () => ({ botId, status: "ready", data }));
        } catch (error) {
            console.error("[BotTelemetryStore] Failed to save bot chat telemetry:", error);
            if (tails.get(botId) !== run) return;
            // A timed-out save may still have landed: ask Orbit what it holds, and fall back to the last confirmed
            const lastConfirmed = confirmed.get(botId);
            let held = lastConfirmed;
            let answered = false;
            try {
                held = await botApiService.getBotTelemetry(botId);
                answered = true;
            } catch {
                // Orbit does not answer: the last confirmed setting stays
            }
            if (tails.get(botId) !== run) return;
            // If Orbit now holds the asked setting and did not before, the save landed late: nothing to report
            const landed = answered && held?.on === on && lastConfirmed?.on !== on;
            if (held) confirmed.set(botId, held);
            update(botId, (state) => ({
                ...state,
                data: held ?? state.data,
                saveError: landed ? undefined : lineOf(error, get(LL).mapEditor.edit.bots.page.telemetry.saveFailed()),
            }));
        } finally {
            if (tails.get(botId) === run) {
                tails.delete(botId);
                confirmed.delete(botId);
            }
        }
    });
    tails.set(botId, run);
    await run;
}

export function clearBotTelemetry(): void {
    latest.clear();
    tails.clear();
    confirmed.clear();
    botTelemetryStore.set(undefined);
}
