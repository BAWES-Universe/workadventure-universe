/**
 * The game's end of the Orbit bridge: the messages the game and Orbit exchange after the sign-in handshake
 * (`orbit-auth-*-v2`, see iframeAuth.ts). Orbit's end is `lib/orbit-bridge.ts` in the Orbit repository; the two must
 * agree on everything here.
 *
 * The game uses it to tell Orbit which page to show (`orbit-navigate`) and when something changed (`orbit-event`, a
 * refresh hint only). Nothing sent over it proves anything: Orbit resolves and authorises every page itself. Orbit's
 * actions on the game (closing, visiting a room) stay on the WorkAdventure scripting API (`WA.*`), so the bridge has no
 * message for them.
 *
 * Every visit (a room join or a reconnect) gets a new room revision. Requests carry it; Orbit refuses one from another
 * revision, and the game ignores answers from another revision, so an old Orbit frame can't act after a room or
 * account change.
 */
export const ORBIT_BRIDGE_VERSION = 1 as const;

/** Pages the game may ask Orbit for. Orbit sends anything it does not know to its home. */
export type OrbitNavigateIntent = "new-universe" | "world-members";

/** What changed, for a refresh hint. */
export type OrbitEventTopic = "all" | "universes" | "worlds" | "rooms" | "profile" | "memberships";

/** How long the game waits for Orbit to acknowledge a request before giving up on it. */
export const ORBIT_REQUEST_TIMEOUT_MS = 10_000;

// Game → Orbit
export interface OrbitBridgeInitMessage {
    type: "orbit-bridge-init";
    version: typeof ORBIT_BRIDGE_VERSION;
    roomRevision: string;
    capabilities: string[];
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

export type OrbitBridgeOutgoing = OrbitBridgeInitMessage | OrbitNavigateMessage | OrbitEventMessage;

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
    private waiting: PendingRequest[] = [];
    private readonly inFlight = new Map<string, unknown>();
    private nextRequest = 0;

    constructor(private readonly env: OrbitBridgeEnv, readonly roomRevision: string) {}

    /** Orbit is signed in and listening: tell it which visit this is, then send what was waiting. */
    onReady(): void {
        this.ready = true;
        this.env.post({
            type: "orbit-bridge-init",
            version: ORBIT_BRIDGE_VERSION,
            roomRevision: this.roomRevision,
            capabilities: ["navigate", "event"],
        });
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

    navigate(intent: OrbitNavigateIntent, params?: Record<string, string>): void {
        this.request({ kind: "navigate", intent, params });
    }

    notifyChanged(topic: OrbitEventTopic): void {
        this.request({ kind: "event", topic });
    }

    get isReady(): boolean {
        return this.ready;
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
