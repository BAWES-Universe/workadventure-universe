import { writable, type Readable } from "svelte/store";

/**
 * "Teach once": a capability the player has learned anywhere is not taught again.
 *
 * Learned means the player either said "I know this" or used the capability often enough on their own. Express needs
 * two separate uses: one tap can be an accident, so a second use only counts once a pause has passed since the first.
 *
 * This is client-side memory for now. Its storage key follows Orbit's preference naming, so the quest engine can
 * move it onto the account (and across devices) without changing the rules here.
 */
export const QUEST_GUIDANCE_KEY = "quests.guidance";

export const CAPABILITY_KEYS = ["express", "chat", "build", "walkTo", "orbit"] as const;
export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];

/** Separate uses a capability needs before it counts as learned. */
export const USES_TO_LEARN: Readonly<Record<CapabilityKey, number>> = {
    express: 2,
    chat: 1,
    build: 1,
    walkTo: 1,
    orbit: 1,
};

/** Two uses closer together than this are one use: a double tap is not practice. */
export const SEPARATE_USE_GAP_MS = 30_000;

export interface CapabilityMemory {
    uses: number;
    lastUseAt: number | null;
    /** Set once, never cleared: by enough uses or by "I know this". */
    learned: boolean;
    /** True when the player said "I know this" rather than learning by use. */
    toldUs: boolean;
}

export interface GuidanceState {
    version: 1;
    capabilities: Partial<Record<CapabilityKey, CapabilityMemory>>;
}

export function emptyGuidance(): GuidanceState {
    return { version: 1, capabilities: {} };
}

export function isCapabilityKey(value: unknown): value is CapabilityKey {
    return typeof value === "string" && (CAPABILITY_KEYS as readonly string[]).includes(value);
}

function memoryOf(state: GuidanceState, key: CapabilityKey): CapabilityMemory {
    return state.capabilities[key] ?? { uses: 0, lastUseAt: null, learned: false, toldUs: false };
}

export function isLearned(state: GuidanceState, key: CapabilityKey): boolean {
    return memoryOf(state, key).learned;
}

/** Whether a quest may show its teaching hint for this capability. */
export function shouldTeach(state: GuidanceState, key: CapabilityKey): boolean {
    return !isLearned(state, key);
}

/** Records one use at `now`. Returns the same state object when nothing changed. */
export function recordUse(state: GuidanceState, key: CapabilityKey, now: number): GuidanceState {
    const memory = memoryOf(state, key);
    if (memory.learned) return state;
    // A clock that went backwards (another device, a changed system time) counts as a fresh use.
    const separate =
        memory.lastUseAt === null || now < memory.lastUseAt || now - memory.lastUseAt >= SEPARATE_USE_GAP_MS;
    if (!separate) return state;
    const uses = memory.uses + 1;
    return {
        ...state,
        capabilities: {
            ...state.capabilities,
            [key]: { uses, lastUseAt: now, learned: uses >= USES_TO_LEARN[key], toldUs: false },
        },
    };
}

/** "I know this": the capability is learned at once and never taught again. */
export function markKnown(state: GuidanceState, key: CapabilityKey): GuidanceState {
    const memory = memoryOf(state, key);
    if (memory.learned) return state;
    return {
        ...state,
        capabilities: { ...state.capabilities, [key]: { ...memory, learned: true, toldUs: true } },
    };
}

const MAX_USES = 1_000;

function parseMemory(raw: unknown): CapabilityMemory | null {
    if (typeof raw !== "object" || raw === null) return null;
    const { uses, lastUseAt, learned, toldUs } = raw as Record<string, unknown>;
    if (typeof uses !== "number" || !Number.isInteger(uses) || uses < 0 || uses > MAX_USES) return null;
    if (lastUseAt !== null && (typeof lastUseAt !== "number" || !Number.isFinite(lastUseAt))) return null;
    if (typeof learned !== "boolean" || typeof toldUs !== "boolean") return null;
    return { uses, lastUseAt, learned, toldUs };
}

/** Reads a saved state, keeping every capability that parses and dropping the rest. Never throws. */
export function parseGuidance(raw: string | null): GuidanceState {
    if (!raw) return emptyGuidance();
    let data: unknown;
    try {
        data = JSON.parse(raw);
    } catch {
        return emptyGuidance();
    }
    if (typeof data !== "object" || data === null) return emptyGuidance();
    const { version, capabilities } = data as Record<string, unknown>;
    if (version !== 1 || typeof capabilities !== "object" || capabilities === null) return emptyGuidance();
    const state = emptyGuidance();
    for (const [key, value] of Object.entries(capabilities)) {
        if (!isCapabilityKey(key)) continue;
        const memory = parseMemory(value);
        if (memory) state.capabilities[key] = memory;
    }
    return state;
}

/** Where guidance lives. Local storage today; the quest engine's preference endpoint later. */
export interface GuidanceStorage {
    load(): string | null;
    save(value: string): void;
}

export const localGuidanceStorage: GuidanceStorage = {
    load() {
        try {
            return localStorage.getItem(QUEST_GUIDANCE_KEY);
        } catch {
            return null;
        }
    },
    save(value) {
        try {
            localStorage.setItem(QUEST_GUIDANCE_KEY, value);
        } catch {
            // Private windows and full storage: guidance is a nicety, play goes on without it.
        }
    },
};

export interface GuidanceStore extends Readable<GuidanceState> {
    recordUse(key: CapabilityKey, now?: number): void;
    markKnown(key: CapabilityKey): void;
}

export function createGuidanceStore(storage: GuidanceStorage = localGuidanceStorage): GuidanceStore {
    let current = parseGuidance(storage.load());
    const { subscribe, set } = writable(current);
    const apply = (next: GuidanceState) => {
        if (next === current) return;
        // Another tab may have learned something meanwhile: merge with what is saved, learned always wins.
        current = mergeGuidance(parseGuidance(storage.load()), next);
        storage.save(JSON.stringify(current));
        set(current);
    };
    return {
        subscribe,
        recordUse(key, now = Date.now()) {
            apply(recordUse(current, key, now));
        },
        markKnown(key) {
            apply(markKnown(current, key));
        },
    };
}

/** Combines two saved states: a capability learned in either stays learned; otherwise the one with more uses wins. */
export function mergeGuidance(a: GuidanceState, b: GuidanceState): GuidanceState {
    const merged = emptyGuidance();
    for (const key of CAPABILITY_KEYS) {
        const left = a.capabilities[key];
        const right = b.capabilities[key];
        if (!left || !right) {
            const only = left ?? right;
            if (only) merged.capabilities[key] = only;
            continue;
        }
        if (left.learned !== right.learned) merged.capabilities[key] = left.learned ? left : right;
        else merged.capabilities[key] = right.uses >= left.uses ? right : left;
    }
    return merged;
}

export const questGuidanceStore = createGuidanceStore();
