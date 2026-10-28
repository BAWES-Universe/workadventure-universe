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

describe("MatrixChatRoom.sendVoiceNote", () => {
    let uploadContent: ReturnType<typeof vi.fn>;
    let sendMessage: ReturnType<typeof vi.fn>;

    function build(): MatrixChatRoom {
        const room = {
            roomId: "!dm:matrix.test",
            name: "DM",
            myUserId: "@me:matrix.test",
            client: {
                getAccountData: () => undefined,
                getRoom: () => null,
                getUserId: () => "@me:matrix.test",
                getSafeUserId: () => "@me:matrix.test",
                uploadContent,
                sendMessage,
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

    const note = () => new File([new Uint8Array(2048)], "Voice message.m4a", { type: "audio/mp4" });

    beforeEach(() => {
        uploadContent = vi.fn(() => Promise.resolve({ content_uri: "mxc://matrix.test/voice" }));
        sendMessage = vi.fn(() => Promise.resolve({ event_id: "$sent" }));
        selectedChatMessageToReply.set(null);
        vi.spyOn(console, "error").mockImplementation(() => {});
    });

    it("sends an audio message flagged as a voice message, with its length and shape, as Element does", async () => {
        await build().sendVoiceNote(note(), { duration: 4.2, waveform: [0.2, 1, 0.5] });

        expect(uploadContent).toHaveBeenCalledOnce();
        const [roomId, content] = sendMessage.mock.calls[0];
        expect(roomId).toBe("!dm:matrix.test");
        expect(content).toMatchObject({
            msgtype: "m.audio",
            body: "Voice message",
            url: "mxc://matrix.test/voice",
            info: { size: 2048, mimetype: "audio/mp4", duration: 4200 },
            "org.matrix.msc3245.voice": {},
            "org.matrix.msc1767.audio": { duration: 4200 },
        });
        expect(content.formatted_body).toBeUndefined();
        const waveform: number[] = content["org.matrix.msc1767.audio"].waveform;
        expect(waveform).toHaveLength(100);
        expect(Math.max(...waveform)).toBe(1024);
    });

    it("replies to the message the box is replying to", async () => {
        selectedChatMessageToReply.set({ id: "$question" } as never);

        await build().sendVoiceNote(note(), { duration: 1, waveform: [1] });

        expect(sendMessage.mock.calls[0][1]["m.relates_to"]).toEqual({ "m.in_reply_to": { event_id: "$question" } });
    });

    it("fails when the upload fails, so the recorder keeps the note to send again", async () => {
        uploadContent.mockImplementationOnce(() => Promise.reject(new Error("offline")));

        await expect(build().sendVoiceNote(note(), { duration: 1, waveform: [1] })).rejects.toThrow("offline");
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it("sends an ordinary audio file without the voice flag", async () => {
        const song = new File([new Uint8Array(10)], "song.mp3", { type: "audio/mpeg" });
        const list = { 0: song, length: 1, item: () => song, [Symbol.iterator]: () => [song][Symbol.iterator]() };

        await build().sendFiles(list as unknown as FileList);

        const content = sendMessage.mock.calls[0][1];
        expect(content.msgtype).toBe("m.audio");
        expect(content.body).toBe("song.mp3");
        expect(content["org.matrix.msc3245.voice"]).toBeUndefined();
    });
});
