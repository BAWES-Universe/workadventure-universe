import * as Sentry from "@sentry/node";
import type { SocketData } from "../models/Websocket/SocketData";
import { toWorldSpaceName } from "./SpaceJoinPolicy";

type GrantSocketData = Pick<
    SocketData,
    "world" | "disconnecting" | "spaces" | "joinSpacesPromise" | "grantedBubbleSpaces"
>;

export interface BubbleSpaceGrantsDependencies<S> {
    getSocketData: (socket: S) => GrantSocketData;
    /** Leaves the space (world-prefixed name) on behalf of the player. */
    leaveSpace: (socket: S, spaceName: string) => Promise<void>;
    /** How long the player has to leave by itself before the server makes it leave. */
    graceMs?: number;
}

/**
 * Bubble spaces belong to the back's groups. The back tells each member to join (joinSpaceRequestMessage) and to
 * leave (leaveSpaceRequestMessage), and both messages go through the pusher before reaching the player. The pusher
 * remembers which bubbles a player was asked to join, so it can refuse any other bubble, and makes sure a player that
 * was asked to leave really leaves.
 *
 * The grant is recorded before the request is passed on to the player, so a player can never ask to join a bubble
 * before its grant exists.
 */
export class BubbleSpaceGrants<S> {
    private readonly graceMs: number;
    private readonly pendingLeaves = new WeakMap<object, Map<string, ReturnType<typeof setTimeout>>>();

    constructor(private readonly deps: BubbleSpaceGrantsDependencies<S>) {
        this.graceMs = deps.graceMs ?? 5000;
    }

    /** The back asked this player to join the bubble (name without the world prefix). */
    grant(socket: S, localSpaceName: string): void {
        const socketData = this.deps.getSocketData(socket);
        this.cancelPendingLeave(socketData, localSpaceName);
        socketData.grantedBubbleSpaces.add(localSpaceName);
    }

    /**
     * The back asked this player to leave the bubble. New joins are refused at once. The player normally leaves on
     * its own straight away; if it is still in the bubble after the grace delay (and was not asked back in meanwhile),
     * the server makes it leave.
     */
    revoke(socket: S, localSpaceName: string): void {
        const socketData = this.deps.getSocketData(socket);
        socketData.grantedBubbleSpaces.delete(localSpaceName);
        this.cancelPendingLeave(socketData, localSpaceName);

        let pending = this.pendingLeaves.get(socketData);
        if (!pending) {
            pending = new Map();
            this.pendingLeaves.set(socketData, pending);
        }
        const timer = setTimeout(() => {
            pending?.delete(localSpaceName);
            if (socketData.disconnecting || socketData.grantedBubbleSpaces.has(localSpaceName)) {
                return;
            }
            const spaceName = toWorldSpaceName(socketData.world, localSpaceName);
            if (!socketData.spaces.has(spaceName) && !socketData.joinSpacesPromise.has(spaceName)) {
                return;
            }
            this.deps.leaveSpace(socket, spaceName).catch((error) => {
                console.error(`Error while making a player leave the bubble space ${spaceName}`, error);
                Sentry.captureException(error);
            });
        }, this.graceMs);
        pending.set(localSpaceName, timer);
    }

    private cancelPendingLeave(socketData: GrantSocketData, localSpaceName: string): void {
        const pending = this.pendingLeaves.get(socketData);
        const timer = pending?.get(localSpaceName);
        if (timer !== undefined) {
            clearTimeout(timer);
            pending?.delete(localSpaceName);
        }
    }
}
