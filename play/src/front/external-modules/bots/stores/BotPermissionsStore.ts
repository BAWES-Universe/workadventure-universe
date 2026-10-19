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
 * keeps showing it while Orbit is asked again.
 */
export async function loadBotPermissions(botId: string): Promise<void> {
    const held = get(botPermissionsStore);
    if (!held || held.botId !== botId || !held.data) botPermissionsStore.set({ botId, status: "loading" });
    try {
        const data = await botApiService.getBotPermissions(botId);
        update(botId, () => ({ botId, status: "ready", data }));
    } catch (error) {
        console.error("[BotPermissionsStore] Failed to load who may use the bot:", error);
        // What the page already shows stays; with nothing to show, it says it could not load
        update(botId, (state) =>
            state.data ? { ...state, saveError: failedToSave(error) } : { botId, status: "failed" }
        );
    }
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

export async function setPrivateBot(botId: string, privateBot: boolean): Promise<void> {
    withData(botId, (data) => ({ ...data, privateBot }));
    try {
        accept(botId, await botApiService.saveBotPermissions(botId, { privateBot }));
    } catch (error) {
        await reloadAfterFailure(botId, error);
    }
}

/** The line refused people hear. Empty clears it, and the bot says a plain default line. */
export async function setRefusalReply(botId: string, refusalReply: string): Promise<void> {
    try {
        accept(botId, await botApiService.saveBotPermissions(botId, { refusalReply: refusalReply.trim() || null }));
    } catch (error) {
        await reloadAfterFailure(botId, error);
    }
}

/** One No / Default / Yes of one row */
export async function setRuleValue(botId: string, rule: BotRule, action: RuleAction, value: RuleValue): Promise<void> {
    const subject = subjectOf(rule);
    withData(botId, (data) => ({
        ...data,
        rules: data.rules.map((r) => (r.id === rule.id ? { ...r, [action]: value } : r)),
    }));
    try {
        const saved = await botApiService.saveBotRule(botId, subject, { [action]: value });
        update(botId, (state) =>
            state.data
                ? {
                      ...state,
                      saveError: undefined,
                      data: { ...state.data, rules: state.data.rules.map((r) => (r.id === saved.id ? saved : r)) },
                  }
                : state
        );
    } catch (error) {
        await reloadAfterFailure(botId, error);
    }
}

/**
 * Add a role or a person to the bot. A new row starts with Yes for chatting, messaging and calling it over, so on a
 * Private bot the person is let in. A role or person who already had a row keeps what it said. Throws a line for the
 * person when Orbit refuses (the bot's owner needs no row, for one); the page shows it.
 */
export async function addRule(botId: string, subject: { roleId: string } | { identifier: string }): Promise<BotRule> {
    try {
        let rule = await botApiService.saveBotRule(botId, subject, {});
        if (saysNothing(rule)) rule = await botApiService.saveBotRule(botId, subjectOf(rule), NEW_ROW_VALUES);
        const saved = rule;
        update(botId, (state) =>
            state.data
                ? {
                      ...state,
                      saveError: undefined,
                      data: {
                          ...state.data,
                          rules: state.data.rules.some((r) => r.id === saved.id)
                              ? state.data.rules.map((r) => (r.id === saved.id ? saved : r))
                              : [...state.data.rules, saved],
                      },
                  }
                : state
        );
        return saved;
    } catch (error) {
        // A row may have been added before the second step failed: go back to what Orbit holds
        await reloadAfterFailure(botId, error);
        throw new Error(failedToSave(error), { cause: error });
    }
}

export async function removeRule(botId: string, rule: BotRule): Promise<void> {
    withData(botId, (data) => ({ ...data, rules: data.rules.filter((r) => r.id !== rule.id) }));
    try {
        await botApiService.deleteBotRule(botId, subjectOf(rule));
        update(botId, (state) => ({ ...state, saveError: undefined }));
    } catch (error) {
        await reloadAfterFailure(botId, error);
    }
}
