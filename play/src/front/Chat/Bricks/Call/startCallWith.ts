import { get } from "svelte/store";
import { LL } from "../../../../i18n/i18n-svelte";
import { warningMessageStore } from "../../../Stores/ErrorStore";
import { callConnection } from "./CallHost";
import type { BeginResult } from "./CallConnection";

/** The one line shown when a call could not start: the owner's own words for a refusal, a plain one otherwise. */
export function callFailureLine(result: Extract<BeginResult, { ok: false }>, botName: string): string | undefined {
    const text = get(LL).chat.brickCall;
    switch (result.failure) {
        case "already_on_a_call":
            return undefined;
        case "not_allowed":
        case "cannot_check":
            return result.reason || text.failed();
        case "no_voice":
            return text.noVoice({ name: botName });
        case "sign_in":
            return text.signIn();
        default:
            return text.failed();
    }
}

/** What the Call button does: start the call, and say why in one line if it does not start. */
export async function startCallWith(botId: string, botName: string): Promise<void> {
    const result = await callConnection.begin(botId, botName);
    if (result.ok) return;
    const line = callFailureLine(result, botName);
    if (line) warningMessageStore.addWarningMessage(line);
}
