/**
 * "Other people" on an app's page (game #2006): the owner lets people who chat with one of their Bricks use a few jobs of
 * one of their apps, as Orbit sends it (`/api/me/apps/:id/bricks/:botId/share`). Nothing here talks to a server or reads a
 * store, so every rule can be unit tested. Orbit never sends the app's link, key or account, so nothing here can show them.
 */

export interface ShareInput {
    name: string;
    required: boolean;
    picked: boolean;
}

export interface ShareJob {
    tool: string;
    title: string;
    description: string | null;
    picked: boolean;
    /** It was shared once and has changed since: it is not shared until it is picked again */
    needsPicking: boolean;
    inputs: ShareInput[];
    /** The fields of its answer, null when the app does not say; `picked` null is the whole answer */
    returns: { names: string[] | null; picked: string[] | null };
}

export interface Share {
    /** False for an app signed in as the person: "Only for you", no button */
    shareable: boolean;
    shared: boolean;
    /** The app answered when its jobs were read; when it did not, nothing can be picked right now */
    reachable: boolean;
    usesPerDayEveryone: number;
    usesPerDayPerson: number;
    usedToday: number;
    jobs: ShareJob[];
}

/** What is sent to Orbit for one job: what people may fill in, and what may come back (null for the whole answer). */
export interface ShareJobChoice {
    tool: string;
    inputs: string[];
    returns: string[] | null;
}

type Raw = Record<string, unknown>;
const isRaw = (value: unknown): value is Raw => !!value && typeof value === "object" && !Array.isArray(value);
const words = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);
const whole = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;

function names(value: unknown): string[] | null | undefined {
    if (value === null) return null;
    if (!Array.isArray(value)) return undefined;
    return value.filter((entry): entry is string => typeof entry === "string" && entry !== "");
}

function input(value: unknown): ShareInput | undefined {
    if (!isRaw(value)) return undefined;
    const name = words(value.name);
    return name ? { name, required: value.required === true, picked: value.picked === true } : undefined;
}

function job(value: unknown): ShareJob | undefined {
    if (!isRaw(value)) return undefined;
    const tool = words(value.tool);
    if (!tool || !Array.isArray(value.inputs)) return undefined;
    const inputs: ShareInput[] = [];
    for (const one of value.inputs) {
        const parsed = input(one);
        // A job with an input that cannot be read is not shown: a half list could offer less than the owner means to
        if (!parsed) return undefined;
        inputs.push(parsed);
    }
    // What it gives back must be said on purpose: a list of fields, or null for the whole answer. Anything else is not read as "the whole
    // answer", which would offer more than the owner may mean to
    if (!isRaw(value.returns)) return undefined;
    const all = names(value.returns.names);
    const picked = names(value.returns.picked);
    if (all === undefined || picked === undefined) return undefined;
    return {
        tool,
        title: words(value.title) ?? tool,
        description: words(value.description) ?? null,
        picked: value.picked === true,
        needsPicking: value.needsPicking === true,
        inputs,
        returns: { names: all, picked },
    };
}

/** What Orbit answers to reading, starting or changing a share. Undefined when it is not that. */
export function parseShare(value: unknown): Share | undefined {
    if (!isRaw(value) || typeof value.shareable !== "boolean" || !Array.isArray(value.jobs)) return undefined;
    const limits = isRaw(value.limits) ? value.limits : {};
    const everyone = whole(limits.usesPerDayEveryone);
    const person = whole(limits.usesPerDayPerson);
    if (everyone === undefined || person === undefined) return undefined;
    const jobs: ShareJob[] = [];
    for (const one of value.jobs) {
        const parsed = job(one);
        if (!parsed) return undefined;
        jobs.push(parsed);
    }
    return {
        shareable: value.shareable,
        shared: value.shared === true,
        reachable: value.reachable !== false,
        usesPerDayEveryone: everyone,
        usesPerDayPerson: person,
        usedToday: whole(value.usedToday) ?? 0,
        jobs,
    };
}

/** The jobs people can ask for now, with their words: "Search the web, Read a page" */
export function pickedTitles(share: Share): string[] {
    return share.jobs.filter((one) => one.picked).map((one) => one.title);
}

/**
 * What a job is set to when the owner opens the choice. A job already shared starts as it is. One not shared starts with only
 * what it cannot work without, and the whole answer: the owner adds more on purpose.
 */
export function startingChoice(one: ShareJob): ShareJobChoice {
    const picked = one.picked
        ? one.inputs.filter((entry) => entry.picked || entry.required)
        : one.inputs.filter((entry) => entry.required);
    const all = one.returns.names;
    const returns = all === null ? null : one.picked && one.returns.picked ? one.returns.picked : [...all];
    return { tool: one.tool, inputs: picked.map((entry) => entry.name), returns };
}

/** One name added or taken out of a list, kept in the order the app gives them. `order` is that order. */
export function toggled(list: string[], name: string, order: string[]): string[] {
    const next = list.includes(name) ? list.filter((one) => one !== name) : [...list, name];
    return order.filter((one) => next.includes(one));
}

/** Whether the choice for a job can be sent: what it needs is offered, and something comes back when the app names fields. */
export function choiceIsComplete(one: ShareJob, choice: ShareJobChoice): boolean {
    if (one.inputs.some((entry) => entry.required && !choice.inputs.includes(entry.name))) return false;
    return one.returns.names === null || (choice.returns !== null && choice.returns.length > 0);
}

/** The uses a day the owner can pick: some starting values, plus the one already set when it is not among them. */
export function limitChoices(kind: "everyone" | "person", current: number): number[] {
    const base = kind === "everyone" ? [20, 50, 100, 200, 500] : [3, 5, 10, 20, 50];
    return base.includes(current) ? base : [...base, current].sort((a, b) => a - b);
}

/**
 * What the owner is told when Orbit would not do a change to a share. Orbit words these (400, 409, 503) for people, so they are
 * shown as they are; anything else, a network failure included, is the plain "didn't go through" line.
 */
export function shareRefusal(error: unknown, fallback: string): string {
    const status = error instanceof Error ? (error as Error & { status?: number }).status : undefined;
    if (error instanceof Error && (status === 400 || status === 409 || status === 503)) {
        const said = error.message.trim();
        if (said && said.length <= 200 && !/^API error/i.test(said)) return said;
    }
    return fallback;
}
