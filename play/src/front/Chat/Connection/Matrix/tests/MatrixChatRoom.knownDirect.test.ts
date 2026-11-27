import { describe, expect, it, vi } from "vitest";
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

describe("a chat made as a direct chat before the account's list of direct chats has arrived", () => {
    /** A chat with one member and no `m.direct` list yet: what the server gives for a chat that has only just been made. */
    function build(knownDirect?: boolean): MatrixChatRoom {
        const room = {
            roomId: "!new:matrix.test",
            name: "Empty room",
            myUserId: "@me:matrix.test",
            client: {
                getAccountData: () => undefined,
                getRoom: () => null,
                getUserId: () => "@me:matrix.test",
                getSafeUserId: () => "@me:matrix.test",
            },
            getUnreadNotificationCount: () => 0,
            getMyMembership: () => "join",
            getJoinedMemberCount: () => 1,
            getDMInviter: () => undefined,
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
        return new MatrixChatRoom(room, undefined, knownDirect);
    }

    it("is direct from the start, and does not look outdated while the list is still missing", () => {
        const room = build(true);
        expect(room.type).toBe("direct");
        expect(room.hasOutdatedType()).toBe(false);
    });

    it("is a group while the list is missing, when it was not made as a direct chat (the type the list later corrects)", () => {
        const room = build();
        expect(room.type).toBe("multiple");
    });
});
