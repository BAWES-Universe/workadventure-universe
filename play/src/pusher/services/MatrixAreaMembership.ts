import * as Sentry from "@sentry/node";
import type { SpaceUser } from "@workadventure/messages";
import type { SocketData } from "../models/Websocket/SocketData";

/**
 * Every tab of a signed-in account shares one Matrix user, but each tab walks in and out of areas on its own.
 * To know whether an account still has a tab inside an area with a Matrix room, every tab that enters such an
 * area is joined (server-side) to a space named `matrix-area:{roomId}`. The back holds the authoritative user
 * list of that space across all pushers, and each pusher keeps a copy of it (Space.users).
 *
 * When a tab leaves the area (or is closed), the account's Matrix user is kicked from the room only when no user
 * left in the space has the same chatID.
 *
 * Enter and leave events of one tab for one room are handled one after the other (the front sends a leave
 * immediately followed by an enter, e.g. when the area properties are updated).
 *
 * The space name has no world prefix, so a browser can never join it through a joinSpaceQuery
 * (those are always prefixed with "{world}.").
 */
export const MATRIX_AREA_SPACE_PREFIX = "matrix-area:";

export function getMatrixAreaSpaceName(roomID: string): string {
    return `${MATRIX_AREA_SPACE_PREFIX}${roomID}`;
}

export function isMatrixAreaSpaceName(spaceName: string): boolean {
    return spaceName.startsWith(MATRIX_AREA_SPACE_PREFIX);
}

export interface MatrixAreaRoomClient {
    inviteUserToRoom(userID: string, roomID: string): Promise<void>;
    promoteUserToModerator(userID: string, roomID: string): Promise<void>;
    kickUserFromRoom(userID: string, roomID: string): Promise<void>;
}

export interface MatrixAreaSpaceView {
    readonly users: ReadonlyMap<string, Pick<SpaceUser, "spaceUserId" | "chatID">>;
}

type MatrixAreaSocketData = Pick<
    SocketData,
    "chatID" | "spaceUserId" | "tags" | "currentChatRoomArea" | "spaces" | "disconnecting"
>;

export interface MatrixAreaSocket {
    getUserData(): MatrixAreaSocketData;
}

export interface MatrixAreaMembershipDependencies<S extends MatrixAreaSocket> {
    matrix: MatrixAreaRoomClient;
    /** Joins the socket to the space (FilterType.ALL_USERS). */
    joinSpace(socket: S, spaceName: string): Promise<void>;
    /** Removes the socket from the space. */
    leaveSpace(socket: S, spaceName: string): Promise<void>;
    /** This pusher's live copy of the space, if it exists. */
    getSpace(spaceName: string): MatrixAreaSpaceView | undefined;
    /** How long to wait for this pusher's copy of the space to drop the leaving tab. */
    removalTimeoutMs?: number;
    removalPollIntervalMs?: number;
}

const DEFAULT_REMOVAL_TIMEOUT_MS = 2000;
const DEFAULT_REMOVAL_POLL_INTERVAL_MS = 20;

export class MatrixAreaMembership<S extends MatrixAreaSocket> {
    private readonly removalTimeoutMs: number;
    private readonly removalPollIntervalMs: number;
    // Per socket and per room: the last queued enter / leave operation.
    private readonly queues = new WeakMap<S, Map<string, Promise<void>>>();

    constructor(private readonly deps: MatrixAreaMembershipDependencies<S>) {
        this.removalTimeoutMs = deps.removalTimeoutMs ?? DEFAULT_REMOVAL_TIMEOUT_MS;
        this.removalPollIntervalMs = deps.removalPollIntervalMs ?? DEFAULT_REMOVAL_POLL_INTERVAL_MS;
    }

    /**
     * A tab enters an area with a Matrix room.
     * Invite and admin promotion stay as they were; the tab is also joined to the area space.
     */
    enter(socket: S, roomID: string): Promise<void> {
        const socketData = socket.getUserData();
        const chatID = socketData.chatID;
        if (!chatID) {
            return Promise.reject(new Error("Error: Chat ID not found"));
        }

        // Recorded right away, so that a leave of this room still in progress knows this tab is back.
        if (!socketData.currentChatRoomArea.includes(roomID)) {
            socketData.currentChatRoomArea.push(roomID);
        }

        return this.enqueue(socket, roomID, async () => {
            if (socketData.disconnecting || !socketData.currentChatRoomArea.includes(roomID)) {
                // The tab was closed, or left again, before we got to this enter.
                return;
            }

            await this.joinAreaSpace(socket, roomID);

            await this.deps.matrix.inviteUserToRoom(chatID, roomID).catch((e) => console.error(e));

            if (socketData.tags.includes("admin")) {
                await this.deps.matrix.promoteUserToModerator(chatID, roomID).catch((e) => console.error(e));
            }
        });
    }

    /**
     * A tab walks out of an area with a Matrix room.
     */
    leave(socket: S, roomID: string): Promise<void> {
        const socketData = socket.getUserData();
        if (!socketData.currentChatRoomArea.includes(roomID)) {
            // Duplicate leave (or leave without enter): this tab is not in the area, nothing to do.
            return Promise.resolve();
        }
        socketData.currentChatRoomArea = socketData.currentChatRoomArea.filter((id) => id !== roomID);
        const { chatID, spaceUserId } = socketData;

        return this.enqueue(socket, roomID, async () => {
            const spaceName = getMatrixAreaSpaceName(roomID);
            const space = this.deps.getSpace(spaceName);
            if (socketData.spaces.has(spaceName)) {
                await this.deps.leaveSpace(socket, spaceName).catch((e) => {
                    console.error("Error while leaving Matrix area space", e);
                });
            }
            await this.release(socket, roomID, chatID, spaceUserId, space);
        });
    }

    /**
     * A tab is closed (or its socket dropped). The spaces themselves are left by the generic space cleanup
     * (SocketManager.leaveSpaces); here we only decide whether the account must be kicked from each room.
     * Everything read from the socket is captured synchronously, before the socket data is reset.
     */
    leaveAll(socket: S): Promise<void> {
        const socketData = socket.getUserData();
        const { chatID, spaceUserId } = socketData;
        const releases = [...new Set(socketData.currentChatRoomArea)].map((roomID) => {
            // Captured now: if this was the last local tab, the space is gone from this pusher once left.
            const capturedSpace = this.deps.getSpace(getMatrixAreaSpaceName(roomID));
            return this.enqueue(socket, roomID, () =>
                this.release(
                    socket,
                    roomID,
                    chatID,
                    spaceUserId,
                    capturedSpace ?? this.deps.getSpace(getMatrixAreaSpaceName(roomID))
                )
            );
        });
        return Promise.all(releases).then(() => undefined);
    }

    /**
     * Runs the operations of one socket for one room one after the other.
     */
    private enqueue(socket: S, roomID: string, operation: () => Promise<void>): Promise<void> {
        let socketQueues = this.queues.get(socket);
        if (!socketQueues) {
            socketQueues = new Map<string, Promise<void>>();
            this.queues.set(socket, socketQueues);
        }
        const queues = socketQueues;
        const previous = queues.get(roomID) ?? Promise.resolve();
        const result = previous.then(operation);
        const tail = result.catch(() => undefined);
        queues.set(roomID, tail);
        tail.then(
            () => {
                if (queues.get(roomID) === tail) {
                    queues.delete(roomID);
                }
            },
            () => undefined
        );
        return result;
    }

    private async joinAreaSpace(socket: S, roomID: string): Promise<void> {
        const spaceName = getMatrixAreaSpaceName(roomID);
        if (socket.getUserData().spaces.has(spaceName)) {
            // Duplicate enter: already joined.
            return;
        }
        try {
            await this.deps.joinSpace(socket, spaceName);
        } catch (e) {
            console.error("Error while joining Matrix area space", e);
            Sentry.captureException(e);
        }
    }

    private async release(
        socket: S,
        roomID: string,
        chatID: string | undefined,
        spaceUserId: string,
        space: MatrixAreaSpaceView | undefined
    ): Promise<void> {
        if (!chatID) {
            return;
        }

        if (space) {
            // The leave answer is not proof that this pusher's copy of the space has caught up: wait until it no
            // longer contains the leaving tab (the removal comes through the space stream). If it never does, the
            // leaving tab is simply ignored below.
            await this.waitForUserRemoval(space, spaceUserId);
        }

        if (socket.getUserData().currentChatRoomArea.includes(roomID)) {
            // This tab entered the area again while it was leaving: it keeps the room.
            return;
        }

        if (!space) {
            // No copy of the area space on this pusher (e.g. the tab could not join it because the back was
            // unreachable): we have no way to know about other tabs, so we keep the previous behaviour.
            await this.kick(chatID, roomID);
            return;
        }

        const anotherTabIsStillThere = Array.from(space.users.values()).some(
            (user) => user.spaceUserId !== spaceUserId && user.chatID === chatID
        );
        if (!anotherTabIsStillThere) {
            await this.kick(chatID, roomID);
        }
    }

    private async kick(chatID: string, roomID: string): Promise<void> {
        await this.deps.matrix.kickUserFromRoom(chatID, roomID).catch((e) => console.error(e));
    }

    private waitForUserRemoval(space: MatrixAreaSpaceView, spaceUserId: string): Promise<void> {
        if (!space.users.has(spaceUserId)) {
            return Promise.resolve();
        }
        const deadline = Date.now() + this.removalTimeoutMs;
        return new Promise<void>((resolve) => {
            const interval = setInterval(() => {
                if (!space.users.has(spaceUserId) || Date.now() >= deadline) {
                    clearInterval(interval);
                    resolve();
                }
            }, this.removalPollIntervalMs);
        });
    }
}
