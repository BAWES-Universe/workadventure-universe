import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Room } from "matrix-js-sdk";

vi.mock("matrix-js-sdk", async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    class FakeTimelineWindow {
        load(): Promise<void> {
            return Promise.resolve();
        }
        canPaginate(): boolean {
            return false;
        }
        getEvents(): unknown[] {
            return [];
        }
    }
    return { ...actual, TimelineWindow: FakeTimelineWindow };
});

vi.mock("../../../Stores/ChatStore", async () => {
    const { writable } = await import("svelte/store");
    return {
        isAChatRoomIsVisible: () => true,
        navChat: writable("chat"),
        selectedChatMessageToReply: writable(null),
        botsChatIds: writable([]),
    };
});
vi.mock("../../../Stores/SelectRoomStore", async () => {
    const { writable } = await import("svelte/store");
    return { selectedRoomStore: writable(undefined) };
});
vi.mock("../../../../Phaser/Game/GameManager", () => ({ gameManager: {} }));
vi.mock("../../../../Connection/LocalUserStore", () => ({ localUserStore: {} }));
vi.mock("../../../../Notification/MessageNotification", () => ({ MessageNotification: class {} }));
vi.mock("../../../../Notification/NotificationManager", () => ({ notificationManager: {} }));
vi.mock("../MatrixMedia", () => ({
    holdMatrixMedia: vi.fn(),
    changingMatrixAvatarStore: () => ({ subscribe: () => () => {} }),
}));
vi.mock("../MatrixSecurity", () => ({
    matrixSecurity: { restoreRoomsMessages: () => Promise.resolve() },
}));
vi.mock("../MatrixChatRoomMember", () => ({ MatrixChatRoomMember: class {} }));
vi.mock("../MatrixChatMessage", () => ({ MatrixChatMessage: class {} }));
vi.mock("../MatrixChatMessageReaction", () => ({ MatrixChatMessageReaction: class {} }));

import { MatrixChatRoom } from "../MatrixChatRoom";

describe("MatrixChatRoom.leaveRoom", () => {
    /** The calls the room made to the server, in order. */
    let calls: string[];
    let leave: ReturnType<typeof vi.fn>;
    let forget: ReturnType<typeof vi.fn>;

    function build(roomId = "!dm:matrix.test"): MatrixChatRoom {
        const room = {
            roomId,
            name: "DM",
            myUserId: "@me:matrix.test",
            client: {
                getAccountData: () => undefined,
                getRoom: () => null,
                getUserId: () => "@me:matrix.test",
                getSafeUserId: () => "@me:matrix.test",
                leave,
                forget,
                kick: vi.fn(),
            },
            getUnreadNotificationCount: () => 0,
            getMyMembership: () => "join",
            getJoinedMemberCount: () => 2,
            getDMInviter: () => "@you:matrix.test",
            getMembers: () => [],
            getLiveTimeline: () => ({ getTimelineSet: () => ({}) }),
            hasEncryptionStateEvent: () => false,
            isSpaceRoom: () => false,
            getMxcAvatarUrl: () => undefined,
            getAvatarFallbackMember: () => undefined,
            getPendingEvents: () => [],
            on: () => {},
            off: () => {},
        } as unknown as Room;
        return new MatrixChatRoom(room, vi.fn() as never);
    }

    beforeEach(() => {
        calls = [];
        leave = vi.fn(() => {
            calls.push("leave");
            return Promise.resolve({});
        });
        forget = vi.fn(() => {
            calls.push("forget");
            return Promise.resolve({});
        });
        vi.spyOn(console, "error").mockImplementation(() => {});
        vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    it("leaves and then forgets the room when asked to forget", async () => {
        await build().leaveRoom({ forget: true });

        expect(calls).toEqual(["leave", "forget"]);
        expect(forget).toHaveBeenCalledWith("!dm:matrix.test");
    });

    it("only leaves when not asked to forget (groups and the other callers)", async () => {
        await build().leaveRoom();

        expect(calls).toEqual(["leave"]);
    });

    it("still counts as deleted when forgetting fails, the leave is not undone, and forgets again later", async () => {
        vi.useFakeTimers();
        try {
            localStorage.clear();
            forget.mockImplementationOnce(() => Promise.reject(new Error("offline")));

            await expect(build().leaveRoom({ forget: true })).resolves.toBeUndefined();

            expect(leave).toHaveBeenCalledOnce();
            expect(forget).toHaveBeenCalledTimes(1);
            // The server answers this time: the room is forgotten without anyone pressing anything.
            await vi.advanceTimersByTimeAsync(10_000);
            expect(forget).toHaveBeenCalledTimes(2);
            expect(forget).toHaveBeenLastCalledWith("!dm:matrix.test");
            await vi.advanceTimersByTimeAsync(60_000);
            expect(forget).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it("shares one retry between chats deleted together, so they do not use up each other's tries", async () => {
        vi.useFakeTimers();
        try {
            localStorage.clear();
            forget.mockImplementation(() => Promise.reject(new Error("offline")));

            await build("!a:matrix.test").leaveRoom({ forget: true });
            await build("!b:matrix.test").leaveRoom({ forget: true });
            expect(forget).toHaveBeenCalledTimes(2);

            await vi.advanceTimersByTimeAsync(10_000);
            // One retry pass tried both; a timer each would have gone through the list twice.
            expect(forget).toHaveBeenCalledTimes(4);
            // Run the chain of tries to its end, so no later test finds it still waiting.
            await vi.advanceTimersByTimeAsync(600_000);
        } finally {
            vi.useRealTimers();
        }
    });

    it("keeps trying with a growing wait when the retry fails too, until the room is forgotten, with no reload", async () => {
        vi.useFakeTimers();
        try {
            localStorage.clear();
            // The first try (the delete itself) and the first retry fail; the third works.
            forget.mockImplementationOnce(() => Promise.reject(new Error("offline")));
            forget.mockImplementationOnce(() => Promise.reject(new Error("offline")));

            await build().leaveRoom({ forget: true });
            expect(forget).toHaveBeenCalledTimes(1);

            await vi.advanceTimersByTimeAsync(10_000);
            expect(forget).toHaveBeenCalledTimes(2);
            // The next wait is longer than the first one.
            await vi.advanceTimersByTimeAsync(29_000);
            expect(forget).toHaveBeenCalledTimes(2);
            await vi.advanceTimersByTimeAsync(1000);
            expect(forget).toHaveBeenCalledTimes(3);
            expect(forget).toHaveBeenLastCalledWith("!dm:matrix.test");
            expect(localStorage.length).toBe(0);

            // Forgotten: nothing is tried again.
            await vi.advanceTimersByTimeAsync(600_000);
            expect(forget).toHaveBeenCalledTimes(3);
        } finally {
            vi.useRealTimers();
        }
    });

    it("fails and does not forget when the leave fails", async () => {
        leave.mockImplementation(() => Promise.reject(new Error("offline")));

        await expect(build().leaveRoom({ forget: true })).rejects.toThrow("Failed to leave room");

        expect(forget).not.toHaveBeenCalled();
    });
});
