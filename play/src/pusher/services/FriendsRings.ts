import crypto from "crypto";
import type { FriendsUpdateMessage, RingAnswer, RingReplyAnswer } from "@workadventure/messages";
import { AvailabilityStatus } from "@workadventure/messages";
import type { SocketData } from "../models/Websocket/SocketData";
import { cleanRoomName } from "./FriendsPresence";
import type { FriendPlace, OrbitFriendRelationship } from "./FriendsService";
import { FriendsError } from "./FriendsService";

type RingsSocketData = Pick<
    SocketData,
    "userUuid" | "isLogged" | "name" | "roomId" | "roomName" | "disconnecting" | "world"
>;

export interface RingsSocket {
    getUserData(): RingsSocketData;
}

export interface FriendsRingsDependencies<S extends RingsSocket> {
    send(socket: S, message: FriendsUpdateMessage): void;
    /** The open tabs an invite can reach: a signed-in player's, or a guest's. */
    socketsOf(userUuid: string): S[];
    /** The most available status across those tabs. */
    statusOf(userUuid: string): AvailabilityStatus;
    /** How the caller stands with the target, from Orbit. May reject with a FriendsError. */
    getRelationship(userUuid: string, targetUuid: string): Promise<OrbitFriendRelationship>;
    /** Who a signed-in player lets invite them, from Orbit. May reject with a FriendsError. */
    getSettings(userUuid: string): Promise<{ ringFrom: string }>;
    /** Display names of a room; null when unknown. Should not reject. */
    lookupPlace(playUri: string): Promise<FriendPlace | null>;
    now?: () => number;
    newId?: () => string;
    /** How long the friend's card rings. */
    ringMs?: number;
    /**
     * How long a caller waits before ringing the same friend again, by how many of their rings that friend has not
     * accepted in a row: the first entry after the first, the second after the second, and the last one from then on.
     */
    waitsMs?: number[];
    /** After this long without a ring from the caller to that friend, the count of unaccepted rings starts over. */
    forgetAfterMs?: number;
    /** How long after an accept the caller is told when their friend walks in. */
    arrivalWatchMs?: number;
}

const DEFAULT_RING_MS = 30 * 1000;
// The second invite works at once, the third and fourth each wait a minute, and from then on it is five minutes.
const DEFAULT_WAITS_MS = [0, 60 * 1000, 60 * 1000, 5 * 60 * 1000];
const DEFAULT_FORGET_AFTER_MS = 30 * 60 * 1000;
const DEFAULT_ARRIVAL_WATCH_MS = 3 * 60 * 1000;

// Someone set to one of these is not disturbed by an invite.
const BUSY_STATUSES: AvailabilityStatus[] = [
    AvailabilityStatus.BUSY,
    AvailabilityStatus.DO_NOT_DISTURB,
    AvailabilityStatus.BACK_IN_A_MOMENT,
];

interface Ring<S> {
    id: string;
    callerUuid: string;
    callerSocket: S;
    targetUuid: string;
    timer: ReturnType<typeof setTimeout>;
}

interface Cooldown {
    until: number;
    unanswered: number;
    lastAt: number;
}

interface ArrivalWatch<S> {
    ringId: string;
    callerSocket: S;
    targetUuid: string;
    timer: ReturnType<typeof setTimeout>;
}

/**
 * Invite someone: their tabs show a card for a while asking them to come over to the caller's room. Anyone in the same
 * world can be invited, guests too; from another world, only a signed-in friend or fellow member of a world they share.
 *
 * In memory, like FriendsPresence: a single pusher sees every connected player. A user rings one friend at a
 * time and is rung by one friend at a time. A ring that ends without being accepted holds the caller back from
 * ringing the same friend again, for longer each time (see DEFAULT_WAITS_MS) until the friend comes over or a while
 * passes, so a ring cannot be used to pester.
 */
export class FriendsRings<S extends RingsSocket> {
    private readonly rings = new Map<string, Ring<S>>();
    // callerUuid => their ring
    private readonly ringByCaller = new Map<string, Ring<S>>();
    // targetUuid => the ring they are getting
    private readonly ringByTarget = new Map<string, Ring<S>>();
    // "caller target" => when the caller may ring that target again, and how many rings in a row were not accepted
    private readonly cooldowns = new Map<string, Cooldown>();
    private readonly arrivals = new Map<string, ArrivalWatch<S>>();

    private readonly now: () => number;
    private readonly newId: () => string;
    private readonly ringMs: number;
    private readonly waitsMs: number[];
    private readonly forgetAfterMs: number;
    private readonly arrivalWatchMs: number;

    constructor(private readonly deps: FriendsRingsDependencies<S>) {
        this.now = deps.now ?? Date.now;
        this.newId = deps.newId ?? (() => crypto.randomUUID());
        this.ringMs = deps.ringMs ?? DEFAULT_RING_MS;
        this.waitsMs = deps.waitsMs?.length ? deps.waitsMs : DEFAULT_WAITS_MS;
        this.forgetAfterMs = deps.forgetAfterMs ?? DEFAULT_FORGET_AFTER_MS;
        this.arrivalWatchMs = deps.arrivalWatchMs ?? DEFAULT_ARRIVAL_WATCH_MS;
    }

    /** The caller (a signed-in player or a guest) invites someone. May reject with what Orbit refused. */
    async ring(callerSocket: S, targetUuid: string): Promise<RingAnswer> {
        const callerUuid = callerSocket.getUserData().userUuid;
        if (targetUuid === callerUuid) {
            return refusal("not_allowed");
        }
        const early = this.refuseNow(callerUuid, targetUuid);
        if (early) {
            return early;
        }

        const refused = await this.refuseReach(callerSocket, targetUuid);
        if (refused) {
            return refused;
        }
        if (this.deps.socketsOf(targetUuid).length === 0) {
            return refusal("offline");
        }
        // Someone else ringing them counts as busy too: one card at a time.
        if (BUSY_STATUSES.includes(this.deps.statusOf(targetUuid)) || this.ringByTarget.has(targetUuid)) {
            return refusal("busy");
        }

        const callerData = callerSocket.getUserData();
        const playUri = callerData.roomId;
        const place = await this.deps.lookupPlace(playUri);

        // Things may have changed while Orbit was asked: another ring started, a tab closed.
        if (callerData.disconnecting) {
            return refusal("not_allowed");
        }
        const late = this.refuseNow(callerUuid, targetUuid);
        if (late) {
            return late;
        }
        const targetSockets = this.deps.socketsOf(targetUuid);
        if (targetSockets.length === 0) {
            return refusal("offline");
        }
        if (BUSY_STATUSES.includes(this.deps.statusOf(targetUuid)) || this.ringByTarget.has(targetUuid)) {
            return refusal("busy");
        }

        const id = this.newId();
        const ring: Ring<S> = {
            id,
            callerUuid,
            callerSocket,
            targetUuid,
            timer: setTimeout(() => this.expire(id), this.ringMs),
        };
        this.rings.set(id, ring);
        this.ringByCaller.set(callerUuid, ring);
        this.ringByTarget.set(targetUuid, ring);

        for (const socket of targetSockets) {
            this.send(socket, {
                update: {
                    $case: "ringIncoming",
                    ringIncoming: {
                        ringId: id,
                        fromUuid: callerUuid,
                        fromName: callerData.name,
                        playUri,
                        roomName: place?.room || cleanRoomName(callerData.roomName),
                        worldName: place?.world ?? "",
                        universeName: place?.universe ?? "",
                        expiresInMs: this.ringMs,
                    },
                },
            });
        }
        return { outcome: "ringing", ringId: id, retryAfterSeconds: 0 };
    }

    /** The caller stops their ring, or the friend accepts or declines it. */
    reply(socket: S, ringId: string, action: string): RingReplyAnswer {
        const ring = this.rings.get(ringId);
        const userUuid = socket.getUserData().userUuid;
        if (!ring) {
            return replyRefused();
        }
        if (action === "stop" && userUuid === ring.callerUuid) {
            this.finish(ring);
            this.sendToTarget(ring, "stopped");
            this.startCooldown(ring);
            return { ok: true, playUri: "", callerUuid: "" };
        }
        if (action === "accept" && userUuid === ring.targetUuid) {
            this.finish(ring);
            this.sendToTarget(ring, "answered", socket);
            this.sendResult(ring, "accepted");
            // They came: the count of rings they did not answer starts over.
            this.cooldowns.delete(cooldownKey(ring.callerUuid, ring.targetUuid));
            this.watchArrival(ring);
            // Where the caller is now, which is where the friend should go.
            return { ok: true, playUri: ring.callerSocket.getUserData().roomId, callerUuid: ring.callerUuid };
        }
        if (action === "decline" && userUuid === ring.targetUuid) {
            this.finish(ring);
            this.sendToTarget(ring, "answered", socket);
            this.sendResult(ring, "declined");
            this.startCooldown(ring);
            return { ok: true, playUri: "", callerUuid: "" };
        }
        return replyRefused();
    }

    /** A socket joined its room: tells a caller the person they invited walked in after accepting. */
    joined(socket: S): void {
        const data = socket.getUserData();
        if (!data.userUuid || data.disconnecting) {
            return;
        }
        for (const watch of Array.from(this.arrivals.values())) {
            if (watch.targetUuid !== data.userUuid || watch.callerSocket.getUserData().roomId !== data.roomId) {
                continue;
            }
            this.stopArrivalWatch(watch);
            this.send(watch.callerSocket, {
                update: {
                    $case: "ringResult",
                    ringResult: { ringId: watch.ringId, targetUuid: watch.targetUuid, result: "arrived" },
                },
            });
        }
    }

    /** A socket is closing (call it once the socket is no longer listed by socketsOf). */
    closed(socket: S): void {
        const userUuid = socket.getUserData().userUuid;

        // The caller left: the ring stops, as if they had stopped it.
        const asCaller = this.ringByCaller.get(userUuid);
        if (asCaller && asCaller.callerSocket === socket) {
            this.finish(asCaller);
            this.sendToTarget(asCaller, "stopped");
            this.startCooldown(asCaller);
        }

        // The friend closed their last tab: nobody is left to answer.
        const asTarget = this.ringByTarget.get(userUuid);
        if (asTarget) {
            const remaining = this.deps.socketsOf(userUuid).filter((other) => other !== socket);
            if (remaining.length === 0) {
                this.finish(asTarget);
                this.sendResult(asTarget, "no_answer");
                this.startCooldown(asTarget);
            }
        }

        for (const watch of Array.from(this.arrivals.values())) {
            if (watch.callerSocket === socket) {
                this.stopArrivalWatch(watch);
            }
        }
    }

    private expire(ringId: string): void {
        const ring = this.rings.get(ringId);
        if (!ring) {
            return;
        }
        this.finish(ring);
        this.sendToTarget(ring, "expired");
        this.sendResult(ring, "no_answer");
        this.startCooldown(ring);
    }

    /**
     * Whether the caller may invite this person at all: same world, anyone (guests too); another world, only signed-in
     * friends or members of a world they share. Then the target's own choice of who may invite them. Undefined when
     * allowed, otherwise the refusal.
     */
    private async refuseReach(callerSocket: S, targetUuid: string): Promise<RingAnswer | undefined> {
        const caller = callerSocket.getUserData();
        const targetSockets = this.deps.socketsOf(targetUuid);
        const sameWorld =
            caller.world !== "" && targetSockets.some((socket) => socket.getUserData().world === caller.world);
        const targetIsGuest =
            targetSockets.length > 0 && targetSockets.every((socket) => !socket.getUserData().isLogged);

        let friends = false;
        let sharedWorld = false;
        let ringFrom = "friends_and_members";
        // A guest has no account to look up: someone who just left is simply not online.
        if (targetSockets.length === 0 && !caller.isLogged) {
            return refusal("offline");
        }
        if (targetIsGuest) {
            // A guest has no settings and no account: only the same world reaches them.
            if (!sameWorld) {
                return refusal("not_friends");
            }
        } else if (caller.isLogged) {
            try {
                const relationship = await this.deps.getRelationship(caller.userUuid, targetUuid);
                if (relationship.relationship === "blocked_by_me" || relationship.relationship === "blocked_by_them") {
                    return refusal("not_friends");
                }
                friends = relationship.relationship === "friends";
                sharedWorld = relationship.sharedWorld === true;
                ringFrom = relationship.target.ringFrom;
            } catch (e) {
                // Not an account and not connected: nobody to invite.
                if (e instanceof FriendsError && e.code === "player_not_found" && targetSockets.length === 0) {
                    return refusal("offline");
                }
                // Orbit holds the player setting and blocks: when it cannot be asked, the invite is declined.
                throw e;
            }
        } else {
            // A guest invites a signed-in player: the same world only, and the player's own choice decides.
            if (!sameWorld) {
                return refusal("not_friends");
            }
            ringFrom = (await this.deps.getSettings(targetUuid)).ringFrom;
        }

        if (!sameWorld && !friends && !sharedWorld) {
            return refusal("not_friends");
        }
        if (ringFrom === "nobody") {
            return refusal("not_allowed");
        }
        // "Friends only" holds even in the same world.
        if (ringFrom === "friends" && !friends) {
            return refusal("not_friends");
        }
        return undefined;
    }

    /** The caller's own checks, which need no call to Orbit; run again once Orbit answered. */
    private refuseNow(callerUuid: string, targetUuid: string): RingAnswer | undefined {
        if (this.ringByCaller.has(callerUuid)) {
            return refusal("already_ringing");
        }
        const until = this.cooldowns.get(cooldownKey(callerUuid, targetUuid))?.until;
        const now = this.now();
        if (until !== undefined && until > now) {
            return { outcome: "too_soon", ringId: "", retryAfterSeconds: Math.ceil((until - now) / 1000) };
        }
        return undefined;
    }

    /** Forgets the ring and its timer; what to tell whom is up to the caller of this method. */
    private finish(ring: Ring<S>): void {
        clearTimeout(ring.timer);
        this.rings.delete(ring.id);
        if (this.ringByCaller.get(ring.callerUuid) === ring) {
            this.ringByCaller.delete(ring.callerUuid);
        }
        if (this.ringByTarget.get(ring.targetUuid) === ring) {
            this.ringByTarget.delete(ring.targetUuid);
        }
    }

    private startCooldown(ring: Ring<S>): void {
        const now = this.now();
        // Pruned whenever one is set, so the map only holds callers who rang lately.
        for (const [key, cooldown] of this.cooldowns) {
            if (now - cooldown.lastAt >= this.forgetAfterMs) {
                this.cooldowns.delete(key);
            }
        }
        const key = cooldownKey(ring.callerUuid, ring.targetUuid);
        const unanswered = (this.cooldowns.get(key)?.unanswered ?? 0) + 1;
        const wait = this.waitsMs[Math.min(unanswered, this.waitsMs.length) - 1];
        this.cooldowns.set(key, { until: now + wait, unanswered, lastAt: now });
    }

    private watchArrival(ring: Ring<S>): void {
        const watch: ArrivalWatch<S> = {
            ringId: ring.id,
            callerSocket: ring.callerSocket,
            targetUuid: ring.targetUuid,
            timer: setTimeout(() => this.arrivals.delete(ring.id), this.arrivalWatchMs),
        };
        this.arrivals.set(ring.id, watch);
    }

    private stopArrivalWatch(watch: ArrivalWatch<S>): void {
        clearTimeout(watch.timer);
        this.arrivals.delete(watch.ringId);
    }

    /** Tells the friend's tabs (but `except`, the one that answered) the card is gone. */
    private sendToTarget(ring: Ring<S>, reason: "stopped" | "expired" | "answered", except?: S): void {
        for (const socket of this.deps.socketsOf(ring.targetUuid)) {
            if (socket !== except) {
                this.send(socket, { update: { $case: "ringEnded", ringEnded: { ringId: ring.id, reason } } });
            }
        }
    }

    private sendResult(ring: Ring<S>, result: "accepted" | "declined" | "no_answer"): void {
        this.send(ring.callerSocket, {
            update: { $case: "ringResult", ringResult: { ringId: ring.id, targetUuid: ring.targetUuid, result } },
        });
    }

    private send(socket: S, message: FriendsUpdateMessage): void {
        if (socket.getUserData().disconnecting) {
            return;
        }
        try {
            this.deps.send(socket, message);
        } catch (e) {
            console.warn("FriendsRings => error while sending", e);
        }
    }
}

function cooldownKey(callerUuid: string, targetUuid: string): string {
    return `${callerUuid} ${targetUuid}`;
}

function refusal(outcome: string): RingAnswer {
    return { outcome, ringId: "", retryAfterSeconds: 0 };
}

function replyRefused(): RingReplyAnswer {
    return { ok: false, playUri: "", callerUuid: "" };
}
