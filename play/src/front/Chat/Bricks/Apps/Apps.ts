/**
 * Apps (game #2001): the apps a person connected, the ones they lent to a universe, and the ones that belong to a universe,
 * as Orbit sends them (`/api/me/apps`, `/api/me/universes`, `/api/me/team-apps`, `/api/bots/:id/apps/available`). Nothing in
 * here talks to a server or reads a store, so every rule can be unit tested. Orbit never sends how an app signs in, only
 * whether it still works.
 */

import { parseGitHubWhere, type GitHubWhere } from "./GitHub";

/** The four things bots may use an app for, as Orbit names them for a lend. */
export const THINGS = ["lookUp", "make", "change", "deleteSend"] as const;
export type Thing = (typeof THINGS)[number];

export type Setting = "rightAway" | "asksFirst" | "off";

export interface AppBrick {
    botId: string;
    botName: string;
    serverId: string;
    enabled: boolean;
    settings: Record<Thing, Setting>;
}

/** One of the person's own apps, with the Bricks of theirs that use it. */
export interface MyApp {
    id: string;
    name: string;
    authType: string;
    /** "link" for an app the person pasted a link for ("Added by you") */
    source: string;
    connected: boolean;
    reconnectRequired: boolean;
    signInLostAt: string | null;
    connectedAt: string;
    /** Whether it can be lent to a universe: only an app added with a link and a key or nothing, never one signed in as the person */
    lendable: boolean;
    bricks: AppBrick[];
}

export interface BrickChoice {
    id: string;
    name: string;
}

export interface LentBot {
    botId: string;
    botName: string;
    serverId: string;
    enabled: boolean;
    usesThisMonth: number;
}

/** Where one of the person's apps is lent, and what bots there may do with it. */
export interface Lend {
    universeId: string;
    universeName: string;
    /** Null when bots there may use it for all four things */
    things: Thing[] | null;
    /** Null for no limit */
    usesPerDay: number | null;
    usedToday: number;
    bots: LentBot[];
}

export interface UniverseChoice {
    id: string;
    name: string;
    /** "owner" owns the universe; "manage" has Manage bots there */
    access: "owner" | "manage";
}

export interface MyAppPage {
    app: MyApp;
    canLetUse: BrickChoice[];
    lentTo: Lend[];
    canLendTo: UniverseChoice[];
    /** The person's GitHub (game #2041): where it works, and where it waits for an owner's OK */
    github?: GitHubWhere;
}

export interface Person {
    id: string;
    name: string;
    /** They own the universe: shown as the owner, and never offered Remove. Absent until Orbit says. */
    owner?: boolean;
    /** It is the person looking at the page. Absent until Orbit says. */
    you?: boolean;
}

export interface TeamApp {
    id: string;
    name: string;
    universeId: string;
    universeName: string;
    authType: string;
    connected: boolean;
    reconnectRequired: boolean;
    signInLostAt: string | null;
    connectedAt: string;
    /** Who connected it, and whether they still manage it. Null when that person is gone. */
    connectedBy: (Person & { stillManages: boolean }) | null;
    managers: Person[];
    bots: { botId: string; botName: string; serverId: string; enabled: boolean }[];
    usesThisMonth: number;
    youManage: boolean;
}

export interface TeamAppPage {
    app: TeamApp;
    canAddAsManager: Person[];
}

/** A universe in "Your universes": the ones where the person manages bots, with how many apps belong to it. */
export interface MyUniverse {
    id: string;
    name: string;
    apps: number;
}

/** An app a bot could also use in its universe: lent there by the person asking, or one of the universe's own. */
export interface AvailableApp {
    connectionId: string;
    name: string;
    kind: "lent" | "team";
}

type Raw = Record<string, unknown>;

const isRaw = (value: unknown): value is Raw => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);
const count = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
const when = (value: unknown): string | null =>
    typeof value === "string" && !Number.isNaN(new Date(value).getTime()) ? value : null;

function list<T>(value: unknown, one: (item: unknown) => T | undefined): T[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const out: T[] = [];
    for (const item of value) {
        const parsed = one(item);
        // One row that cannot be read makes the whole answer unreadable: a half list would hide an app that may be used
        if (parsed === undefined) return undefined;
        out.push(parsed);
    }
    return out;
}

const SETTINGS: Setting[] = ["rightAway", "asksFirst", "off"];

function settings(value: unknown): Record<Thing, Setting> {
    const raw = isRaw(value) ? value : {};
    const pick = (key: Thing): Setting => {
        const found = raw[key];
        return (SETTINGS as unknown[]).includes(found) ? (found as Setting) : "asksFirst";
    };
    return { lookUp: pick("lookUp"), make: pick("make"), change: pick("change"), deleteSend: pick("deleteSend") };
}

function things(value: unknown): Thing[] | null | undefined {
    if (value === null) return null;
    if (!Array.isArray(value)) return undefined;
    const kept = THINGS.filter((thing) => value.includes(thing));
    return kept.length === THINGS.length ? null : kept;
}

function brick(value: unknown): AppBrick | undefined {
    if (!isRaw(value)) return undefined;
    const botId = text(value.botId);
    const botName = text(value.botName);
    const serverId = text(value.serverId);
    if (!botId || !botName || !serverId) return undefined;
    return { botId, botName, serverId, enabled: value.enabled !== false, settings: settings(value.headings) };
}

export function parseMyApp(value: unknown): MyApp | undefined {
    if (!isRaw(value)) return undefined;
    const id = text(value.id);
    const name = text(value.name);
    const bricks = list(value.bricks, brick);
    if (!id || !name || !bricks) return undefined;
    return {
        id,
        name,
        authType: text(value.authType) ?? "none",
        source: text(value.source) ?? "link",
        connected: value.connected !== false,
        reconnectRequired: value.reconnectRequired === true,
        signInLostAt: when(value.signInLostAt),
        connectedAt: when(value.connectedAt) ?? "",
        lendable: value.lendable === true,
        bricks,
    };
}

/** `/api/me/apps`: the person's apps and the Bricks they have. Undefined when it is not that. */
export function parseMyApps(value: unknown): { apps: MyApp[]; bricks: BrickChoice[] } | undefined {
    if (!isRaw(value)) return undefined;
    const apps = list(value.apps, parseMyApp);
    const bricks = list(value.bricks, parseBrickChoice);
    return apps && bricks ? { apps, bricks } : undefined;
}

function parseBrickChoice(value: unknown): BrickChoice | undefined {
    if (!isRaw(value)) return undefined;
    const id = text(value.id);
    const name = text(value.name);
    return id && name ? { id, name } : undefined;
}

function lentBot(value: unknown): LentBot | undefined {
    if (!isRaw(value)) return undefined;
    const botId = text(value.botId);
    const botName = text(value.botName);
    const serverId = text(value.serverId);
    if (!botId || !botName || !serverId) return undefined;
    return {
        botId,
        botName,
        serverId,
        enabled: value.enabled !== false,
        usesThisMonth: count(value.usesThisMonth) ?? 0,
    };
}

function lend(value: unknown): Lend | undefined {
    if (!isRaw(value)) return undefined;
    const universeId = text(value.universeId);
    const universeName = text(value.universeName);
    const lentThings = things(value.things);
    const bots = list(value.bots, lentBot);
    if (!universeId || !universeName || lentThings === undefined || !bots) return undefined;
    const perDay = value.usesPerDay === null ? null : count(value.usesPerDay);
    if (perDay === undefined) return undefined;
    return {
        universeId,
        universeName,
        things: lentThings,
        usesPerDay: perDay,
        usedToday: count(value.usedToday) ?? 0,
        bots,
    };
}

function universeChoice(value: unknown): UniverseChoice | undefined {
    if (!isRaw(value)) return undefined;
    const id = text(value.id);
    const name = text(value.name);
    return id && name ? { id, name, access: value.access === "owner" ? "owner" : "manage" } : undefined;
}

/** `/api/me/apps/:id`: one of the person's apps, with where it is lent and where it could still be. */
export function parseMyAppPage(value: unknown): MyAppPage | undefined {
    if (!isRaw(value)) return undefined;
    const app = parseMyApp(value.app);
    const canLetUse = list(value.canLetUse, parseBrickChoice);
    const lentTo = list(value.lentTo, lend);
    const canLendTo = list(value.canLendTo, universeChoice);
    if (!app || !canLetUse || !lentTo || !canLendTo) return undefined;
    const github = app.source === "github" ? parseGitHubWhere(value.github) : undefined;
    return { app, canLetUse, lentTo, canLendTo, ...(github ? { github } : {}) };
}

function person(value: unknown): Person | undefined {
    if (!isRaw(value)) return undefined;
    const id = text(value.id);
    const name = text(value.name);
    if (!id || !name) return undefined;
    return {
        id,
        name,
        ...(typeof value.owner === "boolean" ? { owner: value.owner } : {}),
        ...(typeof value.you === "boolean" ? { you: value.you } : {}),
    };
}

function teamBot(value: unknown): TeamApp["bots"][number] | undefined {
    if (!isRaw(value)) return undefined;
    const botId = text(value.botId);
    const botName = text(value.botName);
    const serverId = text(value.serverId);
    return botId && botName && serverId ? { botId, botName, serverId, enabled: value.enabled !== false } : undefined;
}

export function parseTeamApp(value: unknown): TeamApp | undefined {
    if (!isRaw(value)) return undefined;
    const id = text(value.id);
    const name = text(value.name);
    const universeId = text(value.universeId);
    const managers = list(value.managers, person);
    const bots = list(value.bots, teamBot);
    if (!id || !name || !universeId || !managers || !bots) return undefined;
    const by = person(value.connectedBy);
    const connectedBy =
        by && isRaw(value.connectedBy) ? { ...by, stillManages: value.connectedBy.stillManages !== false } : null;
    return {
        id,
        name,
        universeId,
        universeName: text(value.universeName) ?? "",
        authType: text(value.authType) ?? "none",
        connected: value.connected !== false,
        reconnectRequired: value.reconnectRequired === true,
        signInLostAt: when(value.signInLostAt),
        connectedAt: when(value.connectedAt) ?? "",
        connectedBy,
        managers,
        bots,
        usesThisMonth: count(value.usesThisMonth) ?? 0,
        youManage: value.youManage !== false,
    };
}

/** `/api/me/universes/:id/apps`: the universe's own apps the person manages. */
export function parseTeamApps(value: unknown): TeamApp[] | undefined {
    return isRaw(value) ? list(value.apps, parseTeamApp) : undefined;
}

/** `/api/me/team-apps/:id`: one of the universe's own apps, and the people who could be added as managers. */
export function parseTeamAppPage(value: unknown): TeamAppPage | undefined {
    if (!isRaw(value)) return undefined;
    const app = parseTeamApp(value.app);
    const canAddAsManager = list(value.canAddAsManager, person);
    return app && canAddAsManager ? { app, canAddAsManager } : undefined;
}

/** `/api/me/universes`: "Your universes". Empty for anyone who manages bots nowhere, so the section does not show. */
export function parseMyUniverses(value: unknown): MyUniverse[] | undefined {
    if (!isRaw(value)) return undefined;
    return list(value.universes, (item) => {
        if (!isRaw(item)) return undefined;
        const id = text(item.id);
        const name = text(item.name);
        return id && name ? { id, name, apps: count(item.apps) ?? 0 } : undefined;
    });
}

/** `/api/bots/:id/apps/available`: "More apps it can use here". */
export function parseAvailableApps(value: unknown): AvailableApp[] | undefined {
    if (!isRaw(value)) return undefined;
    return list(value.apps, (item) => {
        if (!isRaw(item)) return undefined;
        const connectionId = text(item.connectionId);
        const name = text(item.name);
        return connectionId && name ? { connectionId, name, kind: item.kind === "team" ? "team" : "lent" } : undefined;
    });
}

/**
 * Names in a row of words: "Brick", "Brick and Studio Brick", "Brick, Studio Brick and 2 more". Up to `show` names are
 * said; the rest are counted.
 */
export function namesLine(names: string[], and: string, more: (count: number) => string, show = 2): string {
    if (names.length <= show) {
        return names.length <= 1
            ? names.join("")
            : `${names.slice(0, -1).join(", ")} ${and} ${names[names.length - 1]}`;
    }
    return `${names.slice(0, show).join(", ")} ${and} ${more(names.length - show)}`;
}

/** A day like "12 Nov", the same short form the Bricks pages use. */
export function dayOf(at: string | null, locale: string | undefined): string {
    if (!at) return "";
    const date = new Date(at);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString(locale?.toLowerCase().startsWith("en") ? "en-GB" : locale, {
        day: "numeric",
        month: "short",
    });
}

/**
 * The limits a person can pick for "Uses a day there": the starting values, plus the one a lend already has when it is
 * not among them, so Change never shows a choice that is not the real one. Null is "No limit".
 */
export function usesChoices(current: number | null | undefined): (number | null)[] {
    const choices: (number | null)[] = [50, 200, 500, null];
    if (typeof current === "number" && !choices.includes(current)) {
        choices.splice(choices.length - 1, 0, current);
        const numbers = choices.filter((choice): choice is number => choice !== null).sort((a, b) => a - b);
        return [...numbers, null];
    }
    return choices;
}

/** The words of the one-line summary of what a Brick may do with an app, from its four settings. */
export function settingsGroups(settingsOf: Record<Thing, Setting>): {
    rightAway: Thing[];
    asksFirst: Thing[];
    off: Thing[];
} {
    return {
        rightAway: THINGS.filter((thing) => settingsOf[thing] === "rightAway"),
        asksFirst: THINGS.filter((thing) => settingsOf[thing] === "asksFirst"),
        off: THINGS.filter((thing) => settingsOf[thing] === "off"),
    };
}

/** Someone's apps, as the Apps row of the Bricks page says it: "Gmail, Google Calendar, GitHub and 2 more". */
export function appsRowNames(apps: MyApp[], and: string, more: (count: number) => string): string {
    return namesLine(
        apps.map((app) => app.name),
        and,
        more,
        3
    );
}
