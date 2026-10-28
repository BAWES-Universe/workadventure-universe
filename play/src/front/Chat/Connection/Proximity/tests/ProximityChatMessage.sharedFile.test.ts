import { writable } from "svelte/store";
import { describe, expect, it, vi } from "vitest";
import { ProximityChatMessage } from "../ProximityChatRoom";
import type { AnyKindOfUser, ChatMessageType } from "../../ChatConnection";

// The front reads its configuration from window.env at import time.
vi.hoisted(() => {
    (window as unknown as { env: Record<string, unknown> }).env = {};
});

vi.mock("../../../../Phaser/Game/GameManager", () => {
    return {
        gameManager: {
            getCurrentGameScene: () => ({ playSound: () => undefined }),
        },
    };
});

vi.mock("../../../../Phaser/Entity/CharacterLayerManager", () => {
    return {
        CharacterLayerManager: {
            wokaBase64(): Promise<string> {
                return Promise.resolve("");
            },
        },
    };
});

vi.mock("../../../../Api/IframeListener", () => {
    return {
        iframeListener: {
            newChatMessageWritingStatusStream: { subscribe: () => ({ unsubscribe: () => undefined }) },
            startListeningToStreamInBubbleStream: { subscribe: () => ({ unsubscribe: () => undefined }) },
            stopListeningToStreamInBubbleStream: { subscribe: () => ({ unsubscribe: () => undefined }) },
            sendLeaveProximityMeetingEvent: () => undefined,
            sendJoinProximityMeetingEvent: () => undefined,
            sendParticipantJoinProximityMeetingEvent: () => undefined,
            sendParticipantLeaveProximityMeetingEvent: () => undefined,
            sendUserInputChat: () => undefined,
        },
    };
});

// Joining a bubble with someone shows a notification: keep it out of the test environment.
vi.mock("../../../../Notification/NotificationManager", () => {
    return {
        notificationManager: {
            createNotification: () => undefined,
        },
    };
});

vi.mock("../../../../WebRtc/AudioStream/ScriptingOutputAudioStreamManager", () => {
    return {
        ScriptingOutputAudioStreamManager: class {
            close(): void {}
        },
    };
});

vi.mock("../../../../WebRtc/AudioStream/ScriptingInputAudioStreamManager", () => {
    return {
        ScriptingInputAudioStreamManager: class {
            close(): void {}
        },
    };
});

function nearbyMessage(type: ChatMessageType, url: string | undefined, filename?: string): ProximityChatMessage {
    return new ProximityChatMessage(
        "id",
        { username: "Sara" } as AnyKindOfUser,
        writable({ body: "", url, urls: undefined, filename, fileNames: undefined }),
        new Date(),
        false,
        type
    );
}

describe("a nearby message's shared file", () => {
    it("is named after the file it was uploaded as", () => {
        expect(nearbyMessage("file", "https://cdn.test/abc.pdf", "Lobby floor plan.pdf").sharedFile).toEqual({
            name: "Lobby floor plan.pdf",
            size: undefined,
            voice: false,
        });
    });

    it("falls back to the link's last part when the sender gave no name", () => {
        expect(nearbyMessage("image", "https://cdn.test/u/Door%20shot.png?sig=1").sharedFile?.name).toBe(
            "Door shot.png"
        );
    });

    it("is nothing for a text message, a gallery or a message without a link", () => {
        expect(nearbyMessage("proximity", undefined).sharedFile).toBeUndefined();
        expect(nearbyMessage("gallery", "https://cdn.test/a.png").sharedFile).toBeUndefined();
        expect(nearbyMessage("image", undefined).sharedFile).toBeUndefined();
    });
});
