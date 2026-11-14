import { botApiService } from "../../../external-modules/bots/services/BotApiService";
import { loadMyApps } from "./AppsStore";
import { openKeyFormSheet } from "./KeyFormLink";

/**
 * The safe form for a key (Keys for Apps, game #2044). A Brick never takes a key in chat: it opens a link in its words,
 * `[Add your Tap key](#key-form=<id>)`, and this form is where the key is typed. The key goes to Orbit and nowhere else:
 * not into the chat, not into the Brick, not into memory, and it is never read back.
 */

/** What the form shows, as Orbit reads it out for the person it was opened for. */
export interface KeyFormView {
    id: string;
    mode: "prefilled" | "custom";
    name: string;
    short: string;
    keyLabel: string;
    keyHint: string | null;
    /** Where the person finds the key; only ever shown as a link that opens in a new tab */
    helpUrl: string | null;
    host: string;
    hostReadable: string | null;
    source: string | null;
    differentSite: boolean;
    check: string | null;
    replacing: { keyLast4: string | null; mode: "test" | "live" | null } | null;
    triesLeft: number;
}

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The form out of Orbit's answer, or nothing when it is not one. A link to a help page must be a plain https address. */
export function parseKeyForm(value: unknown): KeyFormView | undefined {
    const form = isRecord(value) && isRecord(value.form) ? value.form : value;
    if (!isRecord(form)) return undefined;
    const id = text(form.id);
    const short = text(form.short);
    const host = text(form.host);
    if (!id || !short || !host) return undefined;
    const help = text(form.helpUrl);
    const replacing = isRecord(form.replacing) ? form.replacing : null;
    return {
        id,
        mode: form.mode === "custom" ? "custom" : "prefilled",
        name: text(form.name) ?? short,
        short,
        keyLabel: text(form.keyLabel) ?? `${short} key`,
        keyHint: text(form.keyHint),
        helpUrl: help && /^https:\/\/[^\s]+$/i.test(help) ? help : null,
        host,
        hostReadable: text(form.hostReadable),
        source: text(form.source),
        differentSite: form.differentSite === true,
        check: text(form.check),
        replacing: replacing
            ? {
                  keyLast4: text(replacing.keyLast4),
                  mode: replacing.mode === "test" || replacing.mode === "live" ? replacing.mode : null,
              }
            : null,
        triesLeft: typeof form.triesLeft === "number" ? form.triesLeft : 0,
    };
}

/** What went wrong, in the words the sheet has for it. Never the key, never what the service said. */
export type KeyProblem = "rejected" | "invalid" | "unreachable" | "expired" | "used" | "tooMany" | "other";

export function keyProblemOf(error: unknown): KeyProblem {
    const code = (error as { code?: unknown } | null)?.code;
    switch (code) {
        case "rejected":
            return "rejected";
        case "invalid_key":
            return "invalid";
        case "unreachable":
            return "unreachable";
        case "expired":
        case "not_found":
            return "expired";
        case "used":
            return "used";
        case "too_many":
            return "tooMany";
        default:
            return "other";
    }
}

/** Whether Orbit asked to be sure: the key is a test key where a real one was, or the other way round. */
export function isModeChange(error: unknown): boolean {
    return (error as { code?: unknown } | null)?.code === "mode_change";
}

/** After a key is saved: the person's list of apps is read again so the new app (or the new key end) shows at once. */
export async function afterKeySaved(): Promise<void> {
    try {
        await loadMyApps(true);
    } catch (error) {
        console.warn("Could not read the apps again", error);
    }
}

/** Opens the form for replacing the key of an app of theirs. False when Orbit could not open it. */
export async function replaceKey(connectionId: string): Promise<boolean> {
    try {
        openKeyFormSheet(await botApiService.openKeyForm({ connectionId }));
        return true;
    } catch (error) {
        console.warn("Could not open the key form", error);
        return false;
    }
}

