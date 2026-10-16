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

describe("MatrixChatRoom.joinRoom (accepting an invitation)", () => {
    const ALICE = "@alice:matrix.test";
    let joinRoom: ReturnType<typeof vi.fn>;
    let setAccountData: ReturnType<typeof vi.fn>;
    let directMap: Record<string, string[]> | undefined;

    function build(dmInviter: string | undefined): MatrixChatRoom {
        const room = {
            roomId: "!dm:matrix.test",
            name: "DM",
            myUserId: "@me:matrix.test",
            client: {
                getAccountData: (type: string) =>
                    type === "m.direct" && directMap ? { getContent: () => directMap } : undefined,
                setAccountData,
                http: {
                    authedRequest: () =>
                        directMap
                            ? Promise.resolve(directMap)
                            : Promise.reject(
                                  Object.assign(new Error("not found"), { data: { errcode: "M_NOT_FOUND" } })
                              ),
                },
                getUserId: () => "@me:matrix.test",
                getSafeUserId: () => "@me:matrix.test",
                joinRoom,
            },
            getUnreadNotificationCount: () => 0,
            getMyMembership: () => "invite",
            getDMInviter: () => dmInviter,
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
        directMap = undefined;
        joinRoom = vi.fn().mockResolvedValue({});
        setAccountData = vi.fn().mockImplementation((_type: string, next: Record<string, string[]>) => {
            directMap = next;
            return Promise.resolve({});
        });
        vi.spyOn(console, "error").mockImplementation(() => {});
        vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    it("lists the chat under the person who invited when the invitation was a direct chat", async () => {
        await build(ALICE).joinRoom();

        await vi.waitFor(() => expect(directMap).toEqual({ [ALICE]: ["!dm:matrix.test"] }));
        expect(setAccountData).toHaveBeenCalledOnce();
    });

    it("keeps the chats already listed", async () => {
        directMap = { [ALICE]: ["!older"], "@bob:matrix.test": ["!bobs"] };

        await build(ALICE).joinRoom();

        await vi.waitFor(() =>
            expect(directMap).toEqual({ [ALICE]: ["!older", "!dm:matrix.test"], "@bob:matrix.test": ["!bobs"] })
        );
    });

    it("saves nothing for a group invitation", async () => {
        await build(undefined).joinRoom();

        expect(setAccountData).not.toHaveBeenCalled();
    });

    it("saves nothing when the chat is listed already", async () => {
        directMap = { [ALICE]: ["!dm:matrix.test"] };

        await build(ALICE).joinRoom();

        expect(setAccountData).not.toHaveBeenCalled();
    });

    it("saves nothing when joining fails", async () => {
        joinRoom.mockRejectedValue(new Error("gone"));

        await expect(build(ALICE).joinRoom()).rejects.toThrow("Failed to join room");

        expect(setAccountData).not.toHaveBeenCalled();
    });

    it("still joins when the list cannot be saved", async () => {
        setAccountData.mockRejectedValue(new Error("offline"));

        await expect(build(ALICE).joinRoom()).resolves.toBeUndefined();
    });
});
