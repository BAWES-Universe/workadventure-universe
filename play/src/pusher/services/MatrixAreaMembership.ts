import * as Sentry from "@sentry/node";
import type { SpaceUser } from "@workadventure/messages";
import type { SocketData } from "../models/Websocket/SocketData";

/**
 * Every tab of a signed-in account shares one Matrix user, but each tab walks in and out of areas on its own.
 * To know whether an account still has a tab inside an area with a Matrix room, every tab that enters such an
 * area is joined (server-side) to a space named `matrix-area:{roomId}`. The back holds the authoritative user
 * list of that space across all pushers, and each pusher keeps a copy of it (Space.users).
 *
 * The account's Matrix user is kicked from the room only when no user left in the space has the same chatID.
 * On every enter and leave, the room is also reconciled: any Matrix member whose chatID has no user left in the
 * space is kicked (covers two last tabs leaving at the same moment on different pushers, or a pusher that died).
 *
 * The space name has no world prefix, so a browser can never join it through a joinSpaceQuery
 * (those are always prefixed with "{world}.").
 */
export const MATRIX_AREA_SPACE_PREFIX = "matrix-area:";

export function getMatrixAreaSpaceName(roomID: string): string {
    return `${MATRIX_AREA_SPACE_PREFIX}${roomID}`;
}

export interface MatrixAreaRoomClient {
    inviteUserToRoom(userID: string, roomID: string): Promise<void>;
    promoteUserToModerator(userID: string, roomID: string): Promise<void>;
    kickUserFromRoom(userID: string, roomID: string): Promise<void>;
    /**
     * The Matrix ids of the members of the room that are joined or invited, without the admin account.
     */
    getRoomMemberIds(roomID: string): Promise<string[]>;
}

export interface MatrixAreaSpaceView {
    readonly users: ReadonlyMap<string, Pick<SpaceUser, "spaceUserId" | "chatID">>;
}

type MatrixAreaSocketData = Pick<
    SocketData,
    "chatID" | "spaceUserId" | "tags" | "currentChatRoomArea" | "spaces" | "joinSpacesPromise"
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

    constructor(private readonly deps: MatrixAreaMembershipDependencies<S>) {
        this.removalTimeoutMs = deps.removalTimeoutMs ?? DEFAULT_REMOVAL_TIMEOUT_MS;
        this.removalPollIntervalMs = deps.removalPollIntervalMs ?? DEFAULT_REMOVAL_POLL_INTERVAL_MS;
    }

    /**
     * A tab enters an area with a Matrix room.
     * Invite and admin promotion stay as they were; the tab is also joined to the area space.
     */
    async enter(socket: S, roomID: string): Promise<void> {
        const socketData = socket.getUserData();
        const chatID = socketData.chatID;
        if (!chatID) {
            throw new Error("Error: Chat ID not found");
        }

        if (!socketData.currentChatRoomArea.includes(roomID)) {
            socketData.currentChatRoomArea.push(roomID);
        }

        // Join the space before inviting, so that another pusher reconciling the room sees this tab
        // in the space by the time the invite is visible in Matrix.
        const joined = await this.joinAreaSpace(socket, roomID);

        await this.deps.matrix.inviteUserToRoom(chatID, roomID).catch((e) => console.error(e));

        if (socketData.tags.includes("admin")) {
            await this.deps.matrix.promoteUserToModerator(chatID, roomID).catch((e) => console.error(e));
        }

        if (joined) {
            const space = this.deps.getSpace(getMatrixAreaSpaceName(roomID));
            if (space) {
                this.reconcile(roomID, space).catch((e) => {
                    console.error("Error while reconciling Matrix area room", e);
                    Sentry.captureException(e);
                });
            }
        }
    }

    /**
     * A tab walks out of an area with a Matrix room.
     */
    async leave(socket: S, roomID: string): Promise<void> {
        const socketData = socket.getUserData();
        if (!socketData.currentChatRoomArea.includes(roomID)) {
            // Duplicate leave (or leave without enter): this tab is not in the area, nothing to do.
            return;
        }
        socketData.currentChatRoomArea = socketData.currentChatRoomArea.filter((id) => id !== roomID);

        const spaceName = getMatrixAreaSpaceName(roomID);
        const { chatID, spaceUserId } = socketData;
        const space = this.deps.getSpace(spaceName);
        const wasMember = socketData.spaces.has(spaceName) || socketData.joinSpacesPromise.has(spaceName);

        const leftPromise = wasMember
            ? this.deps.leaveSpace(socket, spaceName).catch((e) => {
                  console.error("Error while leaving Matrix area space", e);
              })
            : Promise.resolve();

        await this.release(roomID, chatID, spaceUserId, wasMember ? space : undefined, leftPromise);
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
            const spaceName = getMatrixAreaSpaceName(roomID);
            const wasMember = socketData.spaces.has(spaceName) || socketData.joinSpacesPromise.has(spaceName);
            const space = wasMember ? this.deps.getSpace(spaceName) : undefined;
            return this.release(roomID, chatID, spaceUserId, space, Promise.resolve());
        });
        return Promise.all(releases).then(() => undefined);
    }

    private async joinAreaSpace(socket: S, roomID: string): Promise<boolean> {
        const socketData = socket.getUserData();
        const spaceName = getMatrixAreaSpaceName(roomID);
        try {
            const pendingJoin = socketData.joinSpacesPromise.get(spaceName);
            if (socketData.spaces.has(spaceName) || pendingJoin) {
                // Duplicate enter: already joined (or joining). Nothing to do.
                await pendingJoin;
                return socketData.spaces.has(spaceName);
            }
            await this.deps.joinSpace(socket, spaceName);
            return true;
        } catch (e) {
            console.error("Error while joining Matrix area space", e);
            Sentry.captureException(e);
            return false;
        }
    }

    private async release(
        roomID: string,
        chatID: string | undefined,
        spaceUserId: string,
        space: MatrixAreaSpaceView | undefined,
        leftPromise: Promise<unknown>
    ): Promise<void> {
        await leftPromise;

        if (!chatID) {
            return;
        }

        if (!space) {
            // This tab never made it into the area space (e.g. the back was unreachable): we have no way to know
            // about other tabs, so we keep the previous behaviour and remove the account from the room.
            await this.kick(chatID, roomID);
            return;
        }

        // The leave answer is not proof that this pusher's copy of the space has caught up: wait until it no longer
        // contains the leaving tab (the removal comes through the space stream). If it never does, the leaving tab
        // is simply ignored below.
        await this.waitForUserRemoval(space, spaceUserId);

        const anotherTabIsStillThere = Array.from(space.users.values()).some(
            (user) => user.spaceUserId !== spaceUserId && user.chatID === chatID
        );
        if (!anotherTabIsStillThere) {
            await this.kick(chatID, roomID);
        }

        // Only reconcile from a copy of the space that is still live on this pusher. When the last local tab left,
        // this pusher no longer receives updates for the space and its copy could be outdated.
        if (this.deps.getSpace(getMatrixAreaSpaceName(roomID)) === space) {
            await this.reconcile(roomID, space, spaceUserId).catch((e) => {
                console.error("Error while reconciling Matrix area room", e);
                Sentry.captureException(e);
            });
        }
    }

    /**
     * Kicks any member of the room whose chatID has no user left in the space.
     */
    async reconcile(roomID: string, space: MatrixAreaSpaceView, ignoredSpaceUserId?: string): Promise<void> {
        const memberIds = await this.deps.matrix.getRoomMemberIds(roomID);
        // Read the space after fetching the members: anyone invited before the fetch had joined the space before
        // being invited.
        const presentChatIds = new Set<string>();
        for (const user of space.users.values()) {
            if (user.chatID && user.spaceUserId !== ignoredSpaceUserId) {
                presentChatIds.add(user.chatID);
            }
        }
        await Promise.all(
            memberIds.filter((memberId) => !presentChatIds.has(memberId)).map((memberId) => this.kick(memberId, roomID))
        );
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
