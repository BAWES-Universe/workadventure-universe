import { describe, expect, it, vi } from "vitest";
import type { SpaceUser } from "@workadventure/messages";
import type {
    MatrixAreaRoomClient,
    MatrixAreaSocket,
    MatrixAreaSpaceView,
} from "../../src/pusher/services/MatrixAreaMembership";
import { getMatrixAreaSpaceName, MatrixAreaMembership } from "../../src/pusher/services/MatrixAreaMembership";

const ROOM = "!area:matrix.test";
const SPACE = getMatrixAreaSpaceName(ROOM);
const ALICE = "@alice:matrix.test";
const BOB = "@bob:matrix.test";

type FakeSocketData = ReturnType<MatrixAreaSocket["getUserData"]>;

class FakeSocket implements MatrixAreaSocket {
    public readonly data: FakeSocketData;
    constructor(spaceUserId: string, chatID: string | undefined, tags: string[] = []) {
        this.data = {
            spaceUserId,
            chatID,
            tags,
            currentChatRoomArea: [],
            spaces: new Set<string>(),
            joinSpacesPromise: new Map<string, Promise<void>>(),
        };
    }
    getUserData(): FakeSocketData {
        return this.data;
    }
}

/**
 * The back: holds the authoritative list of users of the space and pushes every change to each pusher's copy.
 */
class FakeBack {
    public readonly pushers: FakePusher[] = [];
    public readonly users = new Map<string, Pick<SpaceUser, "spaceUserId" | "chatID">>();

    add(user: Pick<SpaceUser, "spaceUserId" | "chatID">) {
        this.users.set(user.spaceUserId, user);
        for (const pusher of this.pushers) {
            pusher.space?.users.set(user.spaceUserId, user);
        }
    }

    remove(spaceUserId: string) {
        this.users.delete(spaceUserId);
        for (const pusher of this.pushers) {
            pusher.space?.users.delete(spaceUserId);
        }
    }
}

/**
 * A pusher with its own copy of the space, created on the first local join and destroyed when its last local
 * tab leaves (like SocketManager.spaces).
 */
class FakePusher {
    public space: { users: Map<string, Pick<SpaceUser, "spaceUserId" | "chatID">> } | undefined;
    public readonly localSockets = new Set<FakeSocket>();
    public readonly membership: MatrixAreaMembership<FakeSocket>;
    // When set, the removal reaches this pusher's copy only after the leave has been answered.
    public delayRemovalMs = 0;

    constructor(private readonly back: FakeBack, matrix: MatrixAreaRoomClient) {
        back.pushers.push(this);
        this.membership = new MatrixAreaMembership<FakeSocket>({
            matrix,
            joinSpace: (socket, spaceName) => this.join(socket, spaceName),
            leaveSpace: (socket, spaceName) => this.leave(socket, spaceName),
            getSpace: (spaceName): MatrixAreaSpaceView | undefined => (spaceName === SPACE ? this.space : undefined),
            removalTimeoutMs: 200,
            removalPollIntervalMs: 5,
        });
    }

    join(socket: FakeSocket, spaceName: string): Promise<void> {
        const data = socket.getUserData();
        if (data.spaces.has(spaceName)) {
            throw new Error("already in space");
        }
        if (!this.space) {
            this.space = { users: new Map(this.back.users) };
        }
        data.spaces.add(spaceName);
        this.localSockets.add(socket);
        this.back.add({ spaceUserId: data.spaceUserId, chatID: data.chatID });
        return Promise.resolve();
    }

    async leave(socket: FakeSocket, spaceName: string): Promise<void> {
        const data = socket.getUserData();
        const space = this.space;
        const spaceUserId = data.spaceUserId;
        if (this.delayRemovalMs > 0) {
            // The back removes the user, but this pusher's copy is updated later.
            this.back.users.delete(spaceUserId);
            for (const pusher of this.back.pushers) {
                if (pusher !== this) pusher.space?.users.delete(spaceUserId);
            }
            setTimeout(() => space?.users.delete(spaceUserId), this.delayRemovalMs);
        } else {
            this.back.remove(spaceUserId);
        }
        data.spaces.delete(spaceName);
        this.localSockets.delete(socket);
        if (this.localSockets.size === 0) {
            this.space = undefined;
        }
        await Promise.resolve();
    }

    /** What SocketManager.cleanupSocket does: release the chat areas, then the generic space cleanup. */
    async close(socket: FakeSocket): Promise<void> {
        const release = this.membership.leaveAll(socket);
        const leaveSpaces = Array.from(socket.getUserData().spaces).map((name) => this.leave(socket, name));
        socket.getUserData().currentChatRoomArea = [];
        await Promise.all([release, ...leaveSpaces]);
    }
}

function createMatrix() {
    const members = new Set<string>();
    const matrix = {
        inviteUserToRoom: vi.fn((userID: string) => {
            members.add(userID);
            return Promise.resolve();
        }),
        promoteUserToModerator: vi.fn(() => Promise.resolve()),
        kickUserFromRoom: vi.fn((userID: string) => {
            members.delete(userID);
            return Promise.resolve();
        }),
        getRoomMemberIds: vi.fn(() => Promise.resolve(Array.from(members))),
    };
    return { matrix, members };
}

const flush = () =>
    new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
    });

describe("MatrixAreaMembership", () => {
    it("keeps the account in the room while another tab of the same account is still in the area", async () => {
        const back = new FakeBack();
        const { matrix, members } = createMatrix();
        const pusher = new FakePusher(back, matrix);
        const tab1 = new FakeSocket("tab-1", ALICE);
        const tab2 = new FakeSocket("tab-2", ALICE);

        await pusher.membership.enter(tab1, ROOM);
        await pusher.membership.enter(tab2, ROOM);
        await flush();
        expect(members.has(ALICE)).toBe(true);

        await pusher.membership.leave(tab1, ROOM);
        await flush();

        expect(matrix.kickUserFromRoom).not.toHaveBeenCalledWith(ALICE, ROOM);
        expect(members.has(ALICE)).toBe(true);
        expect(tab1.data.currentChatRoomArea).toEqual([]);
        expect(tab2.data.currentChatRoomArea).toEqual([ROOM]);
    });

    it("removes the account from the room when its last tab leaves", async () => {
        const back = new FakeBack();
        const { matrix, members } = createMatrix();
        const pusher = new FakePusher(back, matrix);
        const tab1 = new FakeSocket("tab-1", ALICE);
        const tab2 = new FakeSocket("tab-2", ALICE);

        await pusher.membership.enter(tab1, ROOM);
        await pusher.membership.enter(tab2, ROOM);
        await pusher.membership.leave(tab1, ROOM);
        await pusher.membership.leave(tab2, ROOM);
        await flush();

        expect(matrix.kickUserFromRoom).toHaveBeenCalledWith(ALICE, ROOM);
        expect(members.has(ALICE)).toBe(false);
    });

    it("reconciles when a tab is closed abruptly: the other tab keeps access, the last close removes the account", async () => {
        const back = new FakeBack();
        const { matrix, members } = createMatrix();
        const pusher = new FakePusher(back, matrix);
        const tab1 = new FakeSocket("tab-1", ALICE);
        const tab2 = new FakeSocket("tab-2", ALICE);

        await pusher.membership.enter(tab1, ROOM);
        await pusher.membership.enter(tab2, ROOM);

        await pusher.close(tab1);
        await flush();
        expect(matrix.kickUserFromRoom).not.toHaveBeenCalledWith(ALICE, ROOM);
        expect(members.has(ALICE)).toBe(true);
        expect(back.users.has("tab-1")).toBe(false);

        await pusher.close(tab2);
        await flush();
        expect(matrix.kickUserFromRoom).toHaveBeenCalledWith(ALICE, ROOM);
        expect(members.has(ALICE)).toBe(false);
    });

    it("decides correctly when this pusher's copy of the space drops the leaving tab late", async () => {
        const back = new FakeBack();
        const { matrix, members } = createMatrix();
        const pusher = new FakePusher(back, matrix);
        const tab1 = new FakeSocket("tab-1", ALICE);
        const tab2 = new FakeSocket("tab-2", ALICE);
        const bob = new FakeSocket("bob-1", BOB);

        await pusher.membership.enter(tab1, ROOM);
        await pusher.membership.enter(tab2, ROOM);
        await pusher.membership.enter(bob, ROOM);
        await pusher.membership.leave(tab1, ROOM);

        pusher.delayRemovalMs = 30;
        await pusher.membership.leave(tab2, ROOM);
        await flush();

        expect(matrix.kickUserFromRoom).toHaveBeenCalledWith(ALICE, ROOM);
        expect(members.has(ALICE)).toBe(false);
        expect(members.has(BOB)).toBe(true);
    });

    it("ignores duplicate enter and leave events", async () => {
        const back = new FakeBack();
        const { matrix, members } = createMatrix();
        const pusher = new FakePusher(back, matrix);
        const joinSpy = vi.spyOn(pusher, "join");
        const tab1 = new FakeSocket("tab-1", ALICE);
        const tab2 = new FakeSocket("tab-2", ALICE);

        await pusher.membership.enter(tab1, ROOM);
        await pusher.membership.enter(tab1, ROOM);
        await pusher.membership.enter(tab2, ROOM);
        expect(joinSpy).toHaveBeenCalledTimes(2);
        expect(tab1.data.currentChatRoomArea).toEqual([ROOM]);

        await pusher.membership.leave(tab1, ROOM);
        await pusher.membership.leave(tab1, ROOM);
        await flush();

        // The second leave of tab 1 is ignored: tab 2 is still there.
        expect(matrix.kickUserFromRoom).not.toHaveBeenCalledWith(ALICE, ROOM);
        expect(members.has(ALICE)).toBe(true);
    });

    it("keeps access for a tab on another pusher when the last local tab of this pusher leaves", async () => {
        const back = new FakeBack();
        const { matrix, members } = createMatrix();
        const pusherA = new FakePusher(back, matrix);
        const pusherB = new FakePusher(back, matrix);
        const tab1 = new FakeSocket("tab-1", ALICE);
        const tab2 = new FakeSocket("tab-2", ALICE);

        await pusherA.membership.enter(tab1, ROOM);
        await pusherB.membership.enter(tab2, ROOM);

        await pusherA.membership.leave(tab1, ROOM);
        await flush();
        expect(pusherA.space).toBeUndefined();
        expect(members.has(ALICE)).toBe(true);

        await pusherB.membership.leave(tab2, ROOM);
        await flush();
        expect(members.has(ALICE)).toBe(false);
    });

    it("reconciles the room on enter: members with no tab left in the space are removed", async () => {
        const back = new FakeBack();
        const { matrix, members } = createMatrix();
        const pusher = new FakePusher(back, matrix);
        // Bob was left in the room by a pusher that died without kicking him.
        members.add(BOB);
        const tab1 = new FakeSocket("tab-1", ALICE);

        await pusher.membership.enter(tab1, ROOM);
        await flush();

        expect(matrix.kickUserFromRoom).toHaveBeenCalledWith(BOB, ROOM);
        expect(members.has(BOB)).toBe(false);
        expect(members.has(ALICE)).toBe(true);
    });

    it("keeps invite and admin promotion on enter", async () => {
        const back = new FakeBack();
        const { matrix } = createMatrix();
        const pusher = new FakePusher(back, matrix);
        const admin = new FakeSocket("tab-1", ALICE, ["admin"]);

        await pusher.membership.enter(admin, ROOM);

        expect(matrix.inviteUserToRoom).toHaveBeenCalledWith(ALICE, ROOM);
        expect(matrix.promoteUserToModerator).toHaveBeenCalledWith(ALICE, ROOM);
    });

    it("rejects enter without a chat id", async () => {
        const back = new FakeBack();
        const { matrix } = createMatrix();
        const pusher = new FakePusher(back, matrix);

        await expect(pusher.membership.enter(new FakeSocket("guest", undefined), ROOM)).rejects.toThrow();
        expect(matrix.inviteUserToRoom).not.toHaveBeenCalled();
    });

    it("falls back to removing the account when the tab could not join the area space", async () => {
        const back = new FakeBack();
        const { matrix, members } = createMatrix();
        const pusher = new FakePusher(back, matrix);
        vi.spyOn(pusher, "join").mockRejectedValue(new Error("back unreachable"));
        const tab1 = new FakeSocket("tab-1", ALICE);

        await pusher.membership.enter(tab1, ROOM);
        expect(members.has(ALICE)).toBe(true);
        expect(matrix.getRoomMemberIds).not.toHaveBeenCalled();

        await pusher.membership.leave(tab1, ROOM);
        expect(members.has(ALICE)).toBe(false);
    });
});
