/**
 * The game's end of the Orbit bridge: the messages the game and Orbit exchange after the sign-in handshake
 * (`orbit-auth-*-v2`, see iframeAuth.ts). Orbit's end is `lib/orbit-bridge.ts` in the Orbit repository; the two must
 * agree on everything here.
 *
 * The game uses it to tell Orbit which page to show (`orbit-navigate`), when something changed (`orbit-event`, a
 * refresh hint only) and which view its frame is in (`orbit-view`: the compact panel or the full-screen view, which
 * only the game's own maximise button changes). Nothing sent over it proves anything: Orbit resolves and
 * authorises every page itself. Orbit's actions on the game (closing, visiting a room) stay on the WorkAdventure
 * scripting API (`WA.*`), so the bridge has no message for them. The one thing Orbit tells the game is that you
 * renamed yourself in your profile (`orbit-profile-changed`), which the game applies as its own rename does.
 *
 * With quests on, the game also tells Orbit what is in the player's quest log (`orbit-quest-state`, at most eight short
 * entries, no ids of people or rooms) on bridge init and whenever it changes, so Orbit's You page shows the same log.
 *
 * Every visit (a room join or a reconnect) gets a new room revision. Requests carry it; Orbit refuses one from another
 * revision, and the game ignores answers from another revision, so an old Orbit frame can't act after a room or
 * account change.
 */
export const ORBIT_BRIDGE_VERSION = 1 as const;

/** Pages the game may ask Orbit for. Orbit sends anything it does not know to its home. */
export type OrbitNavigateIntent = "new-universe" | "world-members" | "visit-card";

/** What changed, for a refresh hint. */
export type OrbitEventTopic = "all" | "universes" | "worlds" | "rooms" | "profile" | "memberships";

/** The two sizes of Orbit's frame. */
export type OrbitView = "compact" | "full";

/** How long the game waits for Orbit to acknowledge a request before giving up on it. */
export const ORBIT_REQUEST_TIMEOUT_MS = 10_000;

// Game → Orbit
export interface OrbitBridgeInitMessage {
    type: "orbit-bridge-init";
    version: typeof ORBIT_BRIDGE_VERSION;
    roomRevision: string;
    capabilities: string[];
    view: OrbitView;
    /** The longest name the game accepts, so Orbit's profile form can say so. */
    maxNameLength?: number;
}

export interface OrbitNavigateMessage {
    type: "orbit-navigate";
    version: typeof ORBIT_BRIDGE_VERSION;
    requestId: string;
    roomRevision: string;
    intent: OrbitNavigateIntent;
    params?: Record<string, string>;
}

export interface OrbitEventMessage {
    type: "orbit-event";
    version: typeof ORBIT_BRIDGE_VERSION;
    requestId: string;
    roomRevision: string;
    topic: OrbitEventTopic;
}

export interface OrbitViewMessage {
    type: "orbit-view";
    version: typeof ORBIT_BRIDGE_VERSION;
    view: OrbitView;
}

export type OrbitQuestStatus = "tracked" | "accepted" | "done";
export type OrbitQuestStamp = "first-hello" | "explorer" | "builder";

export interface OrbitQuestEntry {
    /** A fixed quest key, e.g. "welcome.meet". */
    id: string;
    title: string;
    status: OrbitQuestStatus;
    stamp?: OrbitQuestStamp;
    /** The host's display name, when there is one. */
    giver?: string;
    /** The room's display name. */
    room: string;
}

/** The player's quest log, as the game shows it. Bounded so a frame can't be flooded. */
export interface OrbitQuestStateMessage {
    type: "orbit-quest-state";
    version: typeof ORBIT_BRIDGE_VERSION;
    /** Like every outgoing message: lets Orbit drop a log from a frame it no longer shows. */
    roomRevision: string;
    entries: OrbitQuestEntry[];
}

export const ORBIT_QUEST_LIMITS = { entries: 8, id: 64, title: 80, giver: 64, room: 80 } as const;

export type OrbitBridgeOutgoing =
    | OrbitBridgeInitMessage
    | OrbitNavigateMessage
    | OrbitEventMessage
    | OrbitViewMessage
    | OrbitQuestStateMessage;

// Orbit → game
export interface OrbitBridgeReadyMessage {
    type: "orbit-bridge-ready";
    version: typeof ORBIT_BRIDGE_VERSION;
    capabilities: string[];
}

export interface OrbitBridgeAckMessage {
    type: "orbit-bridge-ack";
    version: typeof ORBIT_BRIDGE_VERSION;
    requestId: string;
    roomRevision: string;
    ok: boolean;
    error?: string;
}

/** You saved a new name in your Orbit profile (already stored); the game shows it once Orbit closes. */
export interface OrbitProfileChangedMessage {
    type: "orbit-profile-changed";
    version: typeof ORBIT_BRIDGE_VERSION;
    roomRevision: string;
    name: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object";
}

function isBoundedString(value: unknown, min: number, max: number): value is string {
    return typeof value === "string" && value.length >= min && value.length <= max;
}

export function isOrbitBridgeReadyMessage(value: unknown): value is OrbitBridgeReadyMessage {
    return (
        isRecord(value) &&
        value.type === "orbit-bridge-ready" &&
        value.version === ORBIT_BRIDGE_VERSION &&
        Array.isArray(value.capabilities) &&
        value.capabilities.length <= 16 &&
        value.capabilities.every((capability) => isBoundedString(capability, 1, 32))
    );
}

export function isOrbitBridgeAckMessage(value: unknown): value is OrbitBridgeAckMessage {
    return (
        isRecord(value) &&
        value.type === "orbit-bridge-ack" &&
        value.version === ORBIT_BRIDGE_VERSION &&
        isBoundedString(value.requestId, 1, 64) &&
        isBoundedString(value.roomRevision, 16, 128) &&
        typeof value.ok === "boolean" &&
        (value.error === undefined || isBoundedString(value.error, 1, 64))
    );
}

export function isOrbitProfileChangedMessage(value: unknown): value is OrbitProfileChangedMessage {
    return (
        isRecord(value) &&
        value.type === "orbit-profile-changed" &&
        value.version === ORBIT_BRIDGE_VERSION &&
        isBoundedString(value.roomRevision, 16, 128) &&
        isBoundedString(value.name, 1, 128)
    );
}

const QUEST_STATUSES: readonly string[] = ["tracked", "accepted", "done"];
const QUEST_STAMPS: readonly string[] = ["first-hello", "explorer", "builder"];

function isOrbitQuestEntry(value: unknown): value is OrbitQuestEntry {
    return (
        isRecord(value) &&
        isBoundedString(value.id, 1, ORBIT_QUEST_LIMITS.id) &&
        isBoundedString(value.title, 1, ORBIT_QUEST_LIMITS.title) &&
        typeof value.status === "string" &&
        QUEST_STATUSES.includes(value.status) &&
        (value.stamp === undefined || (typeof value.stamp === "string" && QUEST_STAMPS.includes(value.stamp))) &&
        (value.giver === undefined || isBoundedString(value.giver, 1, ORBIT_QUEST_LIMITS.giver)) &&
        isBoundedString(value.room, 0, ORBIT_QUEST_LIMITS.room)
    );
}

export function isOrbitQuestStateMessage(value: unknown): value is OrbitQuestStateMessage {
    return (
        isRecord(value) &&
        value.type === "orbit-quest-state" &&
        value.version === ORBIT_BRIDGE_VERSION &&
        isBoundedString(value.roomRevision, 16, 128) &&
        Array.isArray(value.entries) &&
        value.entries.length <= ORBIT_QUEST_LIMITS.entries &&
        value.entries.every(isOrbitQuestEntry)
    );
}

function clip(text: string, max: number): string {
    return text.length <= max ? text : text.slice(0, max - 1) + "…";
}

/** Trims a log to what the message allows: at most eight entries, each text cut to its limit. */
export function boundOrbitQuestEntries(entries: readonly OrbitQuestEntry[]): OrbitQuestEntry[] {
    return entries.slice(0, ORBIT_QUEST_LIMITS.entries).map((entry) => {
        const giver = entry.giver?.trim();
        return {
            id: clip(entry.id, ORBIT_QUEST_LIMITS.id),
            title: clip(entry.title, ORBIT_QUEST_LIMITS.title),
            status: entry.status,
            ...(entry.stamp ? { stamp: entry.stamp } : {}),
            ...(giver ? { giver: clip(giver, ORBIT_QUEST_LIMITS.giver) } : {}),
            room: clip(entry.room, ORBIT_QUEST_LIMITS.room),
        };
    });
}

/** A fresh room revision for a new visit. */
export function newRoomRevision(): string {
    return `rev-${crypto.randomUUID()}`;
}

export interface OrbitBridgeEnv {
    /** Send to the Orbit frame currently open, if any. */
    post(message: OrbitBridgeOutgoing): void;
    setTimeout(callback: () => void, ms: number): unknown;
    clearTimeout(timer: unknown): void;
}

type PendingRequest =
    | { kind: "navigate"; intent: OrbitNavigateIntent; params?: Record<string, string> }
    | { kind: "event"; topic: OrbitEventTopic };

/**
 * The bridge for one visit. Requests made before Orbit is ready (still signing in, or not open yet) wait and are sent
 * once it says so; closing Orbit drops them, and a new visit gets a new bridge.
 */
export class OrbitBridge {
    private ready = false;
    private view: OrbitView = "compact";
    private waiting: PendingRequest[] = [];
    private readonly inFlight = new Map<string, unknown>();
    private nextRequest = 0;
    /** The player's quest log, once the game has quests on (undefined otherwise: no capability, no message). */
    private questEntries: OrbitQuestEntry[] | undefined;

    constructor(
        private readonly env: OrbitBridgeEnv,
        readonly roomRevision: string,
        private readonly maxNameLength?: number
    ) {}

    /** Orbit is signed in and listening: tell it which visit and view this is, then send what was waiting. */
    onReady(): void {
        this.ready = true;
        this.env.post({
            type: "orbit-bridge-init",
            version: ORBIT_BRIDGE_VERSION,
            roomRevision: this.roomRevision,
            capabilities: ["navigate", "event", "view", "profile", ...(this.questEntries ? ["quests"] : [])],
            view: this.view,
            ...(this.maxNameLength ? { maxNameLength: this.maxNameLength } : {}),
        });
        this.postQuestState();
        const waiting = this.waiting;
        this.waiting = [];
        for (const request of waiting) this.send(request);
    }

    /** Orbit answered a request. Answers for another visit are not ours. */
    onAck(ack: OrbitBridgeAckMessage): void {
        if (ack.roomRevision !== this.roomRevision) return;
        const timer = this.inFlight.get(ack.requestId);
        if (timer === undefined) return;
        this.env.clearTimeout(timer);
        this.inFlight.delete(ack.requestId);
        if (!ack.ok) console.warn(`Orbit could not act on request ${ack.requestId}: ${ack.error ?? "unknown"}`);
    }

    /** Orbit closed: nothing waits for it any more, and it has to say it is ready again next time. */
    onClosed(): void {
        this.ready = false;
        this.waiting = [];
        for (const timer of this.inFlight.values()) this.env.clearTimeout(timer);
        this.inFlight.clear();
    }

    /** The frame changed size (or Orbit is about to open in this size): Orbit lays itself out for it. */
    setView(view: OrbitView): void {
        this.view = view;
        if (this.ready) this.env.post({ type: "orbit-view", version: ORBIT_BRIDGE_VERSION, view });
    }

    /** The quest log changed: Orbit gets it now if it is listening, else on its next init. */
    setQuestState(entries: readonly OrbitQuestEntry[]): void {
        this.questEntries = boundOrbitQuestEntries(entries);
        if (this.ready) this.postQuestState();
    }

    navigate(intent: OrbitNavigateIntent, params?: Record<string, string>): void {
        this.request({ kind: "navigate", intent, params });
    }

    notifyChanged(topic: OrbitEventTopic): void {
        this.request({ kind: "event", topic });
    }

    get isReady(): boolean {
        return this.ready;
    }

    private postQuestState(): void {
        if (!this.questEntries) return;
        const message: OrbitQuestStateMessage = {
            type: "orbit-quest-state",
            version: ORBIT_BRIDGE_VERSION,
            roomRevision: this.roomRevision,
            entries: this.questEntries,
        };
        if (isOrbitQuestStateMessage(message)) this.env.post(message);
        else console.warn("Quests: the log did not fit the Orbit message, not sent");
    }

    private request(request: PendingRequest): void {
        if (this.ready) this.send(request);
        else this.waiting.push(request);
    }

    private send(request: PendingRequest): void {
        this.nextRequest += 1;
        const requestId = `${this.nextRequest}`;
        const base = { version: ORBIT_BRIDGE_VERSION, requestId, roomRevision: this.roomRevision };
        this.env.post(
            request.kind === "navigate"
                ? {
                      ...base,
                      type: "orbit-navigate",
                      intent: request.intent,
                      ...(request.params ? { params: request.params } : {}),
                  }
                : { ...base, type: "orbit-event", topic: request.topic }
        );
        const timer = this.env.setTimeout(() => {
            this.inFlight.delete(requestId);
            console.warn(`Orbit did not answer request ${requestId}`);
        }, ORBIT_REQUEST_TIMEOUT_MS);
        this.inFlight.set(requestId, timer);
    }
}
