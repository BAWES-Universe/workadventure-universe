// Who may use the bot whose page is open: what Orbit says about it, and the changes the page makes. A change shows at
// once and is saved; if Orbit refuses it the page goes back to what Orbit holds and says why (nothing fails silently).
import { get, writable } from "svelte/store";
import LL from "../../../../i18n/i18n-svelte";
import { botApiService } from "../services/BotApiService";
import {
    NEW_ROW_VALUES,
    errorLine,
    saysNothing,
    subjectOf,
    type BotPermissions,
    type BotRule,
    type RuleAction,
    type RuleValue,
} from "../accessModel";

export interface BotPermissionsState {
    botId: string;
    status: "loading" | "ready" | "failed";
    data?: BotPermissions;
    /** Why the last change was not saved, in a line for the person. Cleared by the next change that is. */
    saveError?: string;
}

export const botPermissionsStore = writable<BotPermissionsState | undefined>(undefined);

function failedToSave(error: unknown): string {
    return errorLine(error, get(LL).mapEditor.edit.bots.page.access.saveFailed());
}

/** Update the state, but only if it is still the one for this bot: the page may have moved to another bot meanwhile */
function update(botId: string, change: (state: BotPermissionsState) => BotPermissionsState) {
    botPermissionsStore.update((state) => (state && state.botId === botId ? change(state) : state));
}

/**
 * Read who may use the bot. When the page already holds an answer for this bot (it came back from a rule screen), it
 * keeps showing it while Orbit is asked again. The read waits for the changes already on their way, so it cannot
 * overtake one (a rule just removed must not come back), and a change made after it is not undone by its answer.
 */
export async function loadBotPermissions(botId: string): Promise<void> {
    const held = get(botPermissionsStore);
    if (!held || held.botId !== botId || !held.data) botPermissionsStore.set({ botId, status: "loading" });
    await queued(botId, async (isLast) => {
        try {
            const data = await botApiService.getBotPermissions(botId);
            update(botId, (state) => (isLast() || !state.data ? { botId, status: "ready", data } : state));
        } catch (error) {
            console.error("[BotPermissionsStore] Failed to load who may use the bot:", error);
            // What the page already shows stays; with nothing to show, it says it could not load
            update(botId, (state) =>
                state.data
                    ? { ...state, saveError: errorLine(error, get(LL).mapEditor.edit.bots.page.access.loadFailed()) }
                    : { botId, status: "failed" }
            );
        }
    });
}

export function clearBotPermissions(): void {
    botPermissionsStore.set(undefined);
}

/** Replace what Orbit sent back for this bot, and clear the last error */
function accept(botId: string, data: BotPermissions) {
    update(botId, (state) => ({ ...state, data, status: "ready", saveError: undefined }));
}

/** Go back to what Orbit holds, so the page never shows a change that was not saved */
async function reloadAfterFailure(botId: string, error: unknown): Promise<void> {
    const line = failedToSave(error);
    try {
        const data = await botApiService.getBotPermissions(botId);
        update(botId, (state) => ({ ...state, data, status: "ready", saveError: line }));
    } catch {
        update(botId, (state) => ({ ...state, saveError: line }));
    }
}

function withData(botId: string, change: (data: BotPermissions) => BotPermissions) {
    update(botId, (state) => (state.data ? { ...state, data: change(state.data) } : state));
}

/**
 * Changes to one bot are saved one after the other. Each answer from Orbit holds the row as it was when that change
 * landed, so an answer that arrives while a newer change is still on its way must not replace what the page shows: only
 * the last answer is taken, and by then it holds every change before it.
 */
interface SaveQueue {
    tail: Promise<unknown>;
    pending: number;
    /** A change that Orbit refused while newer ones were still waiting: the last one goes back to what Orbit holds */
    failure?: { error: unknown };
}
const saveQueues = new Map<string, SaveQueue>();

function queued<T>(botId: string, save: (isLast: () => boolean, queue: SaveQueue) => Promise<T>): Promise<T> {
    const queue = saveQueues.get(botId) ?? { tail: Promise.resolve(), pending: 0 };
    saveQueues.set(botId, queue);
    queue.pending++;
    const result = queue.tail.then(() => save(() => queue.pending === 1, queue));
    queue.tail = result
        .catch(() => undefined)
        .then(() => {
            queue.pending--;
            if (queue.pending === 0) saveQueues.delete(botId);
        });
    return result;
}

/** A save went wrong: the last one in the queue goes back to what Orbit holds, an earlier one only remembers it */
async function failed(botId: string, error: unknown, isLast: () => boolean, queue: SaveQueue): Promise<void> {
    if (!isLast()) {
        queue.failure = { error };
        update(botId, (state) => ({ ...state, saveError: failedToSave(error) }));
        return;
    }
    const earlier = queue.failure;
    queue.failure = undefined;
    await reloadAfterFailure(botId, earlier ? earlier.error : error);
}

/** A save went through: the last one in the queue is taken, unless an earlier one was refused */
async function saved(botId: string, isLast: () => boolean, queue: SaveQueue, take: () => void): Promise<void> {
    if (!isLast()) return;
    const earlier = queue.failure;
    queue.failure = undefined;
    if (earlier) await reloadAfterFailure(botId, earlier.error);
    else take();
}

export async function setPrivateBot(botId: string, privateBot: boolean): Promise<void> {
    withData(botId, (data) => ({ ...data, privateBot }));
    await queued(botId, async (isLast, queue) => {
        try {
            const data = await botApiService.saveBotPermissions(botId, { privateBot });
            await saved(botId, isLast, queue, () => accept(botId, data));
        } catch (error) {
            await failed(botId, error, isLast, queue);
        }
    });
}

/** The line refused people hear. Empty clears it, and the bot says a plain default line. */
export async function setRefusalReply(botId: string, refusalReply: string): Promise<boolean> {
    return queued(botId, async (isLast, queue) => {
        try {
            const data = await botApiService.saveBotPermissions(botId, { refusalReply: refusalReply.trim() || null });
            await saved(botId, isLast, queue, () => accept(botId, data));
            return true;
        } catch (error) {
            await failed(botId, error, isLast, queue);
            return false;
        }
    });
}

/** One No / Default / Yes of one row */
export async function setRuleValue(botId: string, rule: BotRule, action: RuleAction, value: RuleValue): Promise<void> {
    const subject = subjectOf(rule);
    withData(botId, (data) => ({
        ...data,
        rules: data.rules.map((r) => (r.id === rule.id ? { ...r, [action]: value } : r)),
    }));
    await queued(botId, async (isLast, queue) => {
        try {
            const row = await botApiService.saveBotRule(botId, subject, { [action]: value });
            await saved(botId, isLast, queue, () =>
                update(botId, (state) =>
                    state.data
                        ? {
                              ...state,
                              saveError: undefined,
                              data: {
                                  ...state.data,
                                  rules: state.data.rules.map((r) => (r.id === row.id ? row : r)),
                              },
                          }
                        : state
                )
            );
        } catch (error) {
            await failed(botId, error, isLast, queue);
        }
    });
}

/**
 * Add a role or a person to the bot. A new row starts with Yes for chatting, messaging and summoning it, so on a
 * Private bot the person is let in. A role or person who already had a row keeps what it said. Throws a line for the
 * person when Orbit refuses (the bot's owner needs no row, for one); the page shows it.
 */
export async function addRule(botId: string, subject: { roleId: string } | { identifier: string }): Promise<BotRule> {
    // In the queue like every other change, so an answer for an earlier change cannot replace the rows without this one
    return queued(botId, async (isLast, queue) => {
        try {
            let rule = await botApiService.saveBotRule(botId, subject, {});
            if (saysNothing(rule)) rule = await botApiService.saveBotRule(botId, subjectOf(rule), NEW_ROW_VALUES);
            const row = rule;
            update(botId, (state) =>
                state.data
                    ? {
                          ...state,
                          data: {
                              ...state.data,
                              rules: state.data.rules.some((r) => r.id === row.id)
                                  ? state.data.rules.map((r) => (r.id === row.id ? row : r))
                                  : [...state.data.rules, row],
                          },
                      }
                    : state
            );
            await saved(botId, isLast, queue, () => update(botId, (state) => ({ ...state, saveError: undefined })));
            return row;
        } catch (error) {
            // A row may have been added before the second step failed: the last change goes back to what Orbit holds
            await failed(botId, error, isLast, queue);
            throw new Error(failedToSave(error), { cause: error });
        }
    });
}

export async function removeRule(botId: string, rule: BotRule): Promise<void> {
    withData(botId, (data) => ({ ...data, rules: data.rules.filter((r) => r.id !== rule.id) }));
    await queued(botId, async (isLast, queue) => {
        try {
            await botApiService.deleteBotRule(botId, subjectOf(rule));
            await saved(botId, isLast, queue, () => update(botId, (state) => ({ ...state, saveError: undefined })));
        } catch (error) {
            await failed(botId, error, isLast, queue);
        }
    });
}
