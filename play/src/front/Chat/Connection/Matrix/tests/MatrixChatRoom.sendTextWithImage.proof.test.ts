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
import { selectedChatMessageToReply } from "../../../Stores/ChatStore";


describe("PROOF: today's text + picture send (composer order: sendFiles first, then sendMessage, neither awaited)", () => {
    let uploadContent: ReturnType<typeof vi.fn>;
    let sendMessage: ReturnType<typeof vi.fn>;
    const order: string[] = [];

    function build(): MatrixChatRoom {
        const room = {
            roomId: "!dm:matrix.test", name: "DM", myUserId: "@me:matrix.test",
            client: { getAccountData: () => undefined, getRoom: () => null, getUserId: () => "@me:matrix.test",
                getSafeUserId: () => "@me:matrix.test", uploadContent, sendMessage },
            getUnreadNotificationCount: () => 0, getMyMembership: () => "join", getJoinedMemberCount: () => 2,
            getDMInviter: () => "@you:matrix.test", getMembers: () => [],
            getLiveTimeline: () => ({ getTimelineSet: () => ({}) }), hasEncryptionStateEvent: () => false,
            isSpaceRoom: () => false, getMxcAvatarUrl: () => undefined, getAvatarFallbackMember: () => undefined,
            getPendingEvents: () => [], on: () => {}, off: () => {},
        } as unknown as Room;
        return new MatrixChatRoom(room, vi.fn() as never);
    }
    const pic = (name: string) => new File([new Uint8Array(10)], name, { type: "image/png" });
    const list = (...files: File[]) => ({ ...files, length: files.length, item: (i: number) => files[i], [Symbol.iterator]: () => files[Symbol.iterator]() }) as unknown as FileList;

    beforeEach(() => {
        order.length = 0;
        sendMessage = vi.fn((_room: string, content: { msgtype: string; body: string }) => { order.push(`${content.msgtype}:${content.body}`); return Promise.resolve({ event_id: "$x" }); });
        selectedChatMessageToReply.set(null);
        vi.spyOn(console, "error").mockImplementation(() => {});
    });

    it("1. text reaches the room first, the picture follows only when its upload ends", async () => {
        let finishUpload!: () => void;
        uploadContent = vi.fn(() => new Promise((resolve) => { finishUpload = () => resolve({ content_uri: "mxc://m/pic" }); }));
        const room = build();
        const sending = room.sendFiles(list(pic("a.png")));
        room.sendMessage("look at this");
        await Promise.resolve(); await Promise.resolve();
        console.log("PROOF1 before upload ends:", JSON.stringify(order));
        finishUpload(); await sending;
        console.log("PROOF1 after upload ends:", JSON.stringify(order));
        expect(order).toEqual(["m.text:look at this", "m.image:a.png"]);
    });

    it("2. several pictures arrive in the order their uploads END, not the order picked", async () => {
        const finish: Record<string, () => void> = {};
        uploadContent = vi.fn((file: File) => new Promise((resolve) => { finish[file.name] = () => resolve({ content_uri: "mxc://m/" + file.name }); }));
        const room = build();
        const sending = room.sendFiles(list(pic("big.png"), pic("small.png")));
        await Promise.resolve();
        finish["small.png"](); await Promise.resolve(); await Promise.resolve();
        finish["big.png"](); await sending;
        console.log("PROOF2:", JSON.stringify(order));
        expect(order).toEqual(["m.image:small.png", "m.image:big.png"]);
    });

    it("3. a failed upload is swallowed: sendFiles resolves, no event, the composer cannot tell", async () => {
        uploadContent = vi.fn(() => Promise.reject(new Error("offline")));
        const room = build();
        const result = await room.sendFiles(list(pic("a.png"))).then(() => "resolved", () => "rejected");
        console.log("PROOF3 sendFiles:", result, "events:", JSON.stringify(order));
        expect(result).toBe("resolved");
        expect(order).toEqual([]);
    });

    it("4. a reply loses its reply link on the picture (text clears the reply while the upload runs)", async () => {
        let finishUpload!: () => void;
        uploadContent = vi.fn(() => new Promise((resolve) => { finishUpload = () => resolve({ content_uri: "mxc://m/pic" }); }));
        selectedChatMessageToReply.set({ id: "$question" } as never);
        const room = build();
        const sending = room.sendFiles(list(pic("a.png")));
        room.sendMessage("answer");
        await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
        finishUpload(); await sending;
        const [textCall, imageCall] = sendMessage.mock.calls.map((c) => c[1]);
        console.log("PROOF4 text relates_to:", JSON.stringify(textCall["m.relates_to"]), "| image relates_to:", JSON.stringify(imageCall["m.relates_to"]));
        expect(textCall["m.relates_to"]).toBeDefined();
        expect(imageCall["m.relates_to"]).toBeUndefined();
    });
});
