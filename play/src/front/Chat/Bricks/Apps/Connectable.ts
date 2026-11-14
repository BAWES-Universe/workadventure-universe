import type { MyApp } from "./Apps";

/**
 * "Connect another" on the Apps page (game #2001): the apps a person can connect with one tap, from the two lists Orbit keeps
 * (`GET /api/me/apps/catalog`, apps that sign in on their own official page, and `GET /api/me/apps/ready-made`, which answers
 * 404 while that is not available and is then just empty). Nothing in here talks to a server or reads a store, so every rule
 * can be unit tested. Orbit never sends a link or how an app signs in, only its name, one line and whether it is connected.
 */

/** Which of Orbit's two lists an app is on: it decides which call connects it. */
export type ConnectKind = "listed" | "readyMade";

export interface Connectable {
    kind: ConnectKind;
    /** Orbit's key for it, the one Connect sends back */
    key: string;
    name: string;
    /** One line under the name ("Notes and docs"); the ready-made list has none */
    blurb: string;
    /** The person's own connection made from it, when they have one (it may not be signed in yet) */
    connectionId: string | null;
}

type Raw = Record<string, unknown>;

const isRaw = (value: unknown): value is Raw => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);

function readList(value: unknown, kind: ConnectKind): Connectable[] | undefined {
    if (!isRaw(value) || !Array.isArray(value.apps)) return undefined;
    const out: Connectable[] = [];
    for (const item of value.apps) {
        if (!isRaw(item)) return undefined;
        const key = text(item.key);
        const name = text(item.name);
        // One row that cannot be read makes the whole answer unreadable: a half list would hide an app that can be connected
        if (!key || !name) return undefined;
        out.push({ kind, key, name, blurb: text(item.blurb) ?? "", connectionId: text(item.connectionId) ?? null });
    }
    return out;
}

/** `/api/me/apps/catalog`: undefined when it is not that. */
export const parseCatalog = (value: unknown): Connectable[] | undefined => readList(value, "listed");

/** `/api/me/apps/ready-made`: undefined when it is not that. */
export const parseReadyMade = (value: unknown): Connectable[] | undefined => readList(value, "readyMade");

/**
 * Whether an app of the person's belongs under "Connected": its sign-in is done (or ended, so Reconnect is what it needs), or
 * it is one they pasted a link for, which is always theirs to see. A listed or ready-made app they started and never finished
 * signing in to is not connected yet: it is under "Connect another" with its Connect.
 */
export const isConnectedApp = (app: MyApp): boolean => app.source === "link" || app.connected || app.reconnectRequired;

const nameKey = (name: string) => name.trim().toLowerCase();

/**
 * What goes under "Connect another": the apps on either list the person has not finished connecting. One that is connected
 * lives under "Connected" (it is theirs, with the Bricks that use it); one whose sign-in was never finished, or ended, is
 * still here with its Connect, which starts the sign-in again for the same connection. A ready-made app that has the same
 * name as a listed one is shown once, as the listed one.
 */
export function toConnectAnother(all: Connectable[], mine: MyApp[]): Connectable[] {
    const finished = mine.filter(isConnectedApp);
    const doneIds = new Set(finished.map((app) => app.id));
    // An app the person pasted a link for does not hide an official app of the same name: it is another app
    const taken = new Set(finished.filter((app) => app.source !== "link").map((app) => nameKey(app.name)));
    const out: Connectable[] = [];
    for (const app of all) {
        if ((app.connectionId && doneIds.has(app.connectionId)) || taken.has(nameKey(app.name))) continue;
        taken.add(nameKey(app.name));
        out.push(app);
    }
    return out;
}

const norm = (value: string) => value.trim().toLowerCase();

/** Whether what the person typed in Search apps is in this name or line, whatever the case. Nothing typed matches all. */
export function matchesSearch(query: string, ...fields: string[]): boolean {
    const wanted = norm(query);
    return wanted === "" || fields.some((field) => norm(field).includes(wanted));
}
