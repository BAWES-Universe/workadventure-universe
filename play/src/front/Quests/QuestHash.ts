/**
 * The page's hash as it was when the quest code loaded. GameScene consumes and clears `#moveTo` once the map is up,
 * so the arrival rules read this copy instead of the live hash.
 */
export interface QuestHashSnapshot {
    moveTo: boolean;
    moveToUser: boolean;
    /** Area name set by Orbit's Visit link: the Explore target to prefer. */
    questArea: string | undefined;
    /** Host set by Orbit's Visit link: `bot:<uuid>`, `area:<name>` or `none`. */
    questHost: QuestHostOverride | undefined;
}

export type QuestHostOverride = { kind: "bot"; uuid: string } | { kind: "area"; name: string } | { kind: "none" };

export type ArrivalRule =
    /** The person came for someone: no invitation on this arrival. */
    | "skip"
    /** Spawned at a point: wait for that first walk to end, then the normal delay. */
    | "after-move"
    | "normal";

const MAX_HASH_VALUE_LENGTH = 128;

function decode(value: string | undefined): string | undefined {
    if (value === undefined || value === "") return undefined;
    try {
        const decoded = decodeURIComponent(value).trim();
        return decoded && decoded.length <= MAX_HASH_VALUE_LENGTH ? decoded : undefined;
    } catch {
        return undefined;
    }
}

/** Same splitting as UrlManager.getHashParameters (`key=value` pairs joined by `&`). */
export function parseHashParameters(hash: string): Record<string, string | undefined> {
    const parameters: Record<string, string | undefined> = {};
    for (const item of hash.replace(/^#/, "").split("&")) {
        if (!item) continue;
        const [key, value] = item.split("=");
        parameters[key] = value;
    }
    return parameters;
}

export function parseQuestHostOverride(raw: string | undefined): QuestHostOverride | undefined {
    const value = decode(raw);
    if (!value) return undefined;
    if (value === "none") return { kind: "none" };
    const separator = value.indexOf(":");
    if (separator === -1) return undefined;
    const kind = value.slice(0, separator);
    const target = value.slice(separator + 1).trim();
    if (!target) return undefined;
    if (kind === "bot") return { kind: "bot", uuid: target };
    if (kind === "area") return { kind: "area", name: target };
    return undefined;
}

export function parseQuestHash(hash: string): QuestHashSnapshot {
    const parameters = parseHashParameters(hash);
    return {
        moveTo: "moveTo" in parameters && parameters.moveTo !== undefined && parameters.moveTo !== "",
        moveToUser: "moveToUser" in parameters && parameters.moveToUser !== undefined && parameters.moveToUser !== "",
        questArea: decode(parameters.questArea),
        questHost: parseQuestHostOverride(parameters.questHost),
    };
}

export const EMPTY_HASH_SNAPSHOT: QuestHashSnapshot = {
    moveTo: false,
    moveToUser: false,
    questArea: undefined,
    questHost: undefined,
};

/**
 * Only a link to a person skips the invitation. `#moveTo` is a spawn point (every invite link carries one), and a
 * start-position key is where the map puts you: neither says why you came.
 */
export function arrivalRule(snapshot: QuestHashSnapshot): ArrivalRule {
    if (snapshot.moveToUser) return "skip";
    if (snapshot.moveTo) return "after-move";
    return "normal";
}

function readHash(): string {
    try {
        return typeof window === "undefined" ? "" : window.location.hash;
    } catch {
        return "";
    }
}

let snapshot: QuestHashSnapshot = parseQuestHash(readHash());

/**
 * The snapshot for this arrival. It belongs to the first map the page opened: once that map has loaded, later maps
 * (a door to another room, a reconnect) are judged on an empty one.
 */
export function questHashSnapshot(): QuestHashSnapshot {
    return snapshot;
}

export function consumeQuestHashSnapshot(): void {
    snapshot = EMPTY_HASH_SNAPSHOT;
}

/**
 * The Explore area and host the owner published, for the map arriving now: from the live hash when a later map was
 * opened with them (Orbit's Visit inside the same page), else from the arrival snapshot.
 */
export function questTargetsForArrival(
    liveHash: string = readHash()
): Pick<QuestHashSnapshot, "questArea" | "questHost"> {
    const live = parseQuestHash(liveHash);
    if (live.questArea !== undefined || live.questHost !== undefined) {
        return { questArea: live.questArea, questHost: live.questHost };
    }
    return { questArea: snapshot.questArea, questHost: snapshot.questHost };
}
