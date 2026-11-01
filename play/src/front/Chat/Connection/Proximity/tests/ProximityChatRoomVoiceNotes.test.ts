import { Subject } from "rxjs";
import { get, readable, writable } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProximityChatRoom } from "../ProximityChatRoom";
import type { ProximityChatMessage } from "../ProximityChatRoom";
import type { SpaceInterface, SpaceUserExtended } from "../../../../Space/SpaceInterface";
import type { SpaceRegistryInterface } from "../../../../Space/SpaceRegistry/SpaceRegistryInterface";
import type { RemotePlayersRepository } from "../../../../Phaser/Game/RemotePlayersRepository";

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

type PublicEvent = { sender: string } & Record<string, unknown>;

function createFakeSpace() {
    const publicEvents = new Map<string, Subject<PublicEvent>>();
    const eventSubject = (name: string) => {
        let subject = publicEvents.get(name);
        if (!subject) {
            subject = new Subject<PublicEvent>();
            publicEvents.set(name, subject);
        }
        return subject;
    };
    const space = {
        destroyed: false,
        usersStore: writable(new Map<string, SpaceUserExtended>()),
        observeUserJoined: new Subject<SpaceUserExtended>(),
        observeUserLeft: new Subject<SpaceUserExtended>(),
        onLeaveSpace: new Subject<void>(),
        observePublicEvent: (name: string) => eventSubject(name).asObservable(),
        observePrivateEvent: () => new Subject().asObservable(),
        emitPublicMessage: vi.fn(),
        getName: () => "bubble",
        getUsers: () => Promise.resolve(get(space.usersStore)),
    };
    const emit = (name: string, event: PublicEvent) => eventSubject(name).next(event);
    return { space, emit };
}

function spaceUser(spaceUserId: string, name: string, uuid: string): SpaceUserExtended {
    return {
        spaceUserId,
        name,
        uuid,
        tags: [],
        pictureStore: readable(undefined),
        reactiveUser: { availabilityStatus: readable(0) },
    } as unknown as SpaceUserExtended;
}

describe("Nearby chat voice notes", () => {
    let room: ProximityChatRoom;
    let fake: ReturnType<typeof createFakeSpace>;

    beforeEach(async () => {
        fake = createFakeSpace();
        const spaceRegistry = {
            joinSpace: () => Promise.resolve(fake.space as unknown as SpaceInterface),
            leaveSpace: () => Promise.resolve(),
        } as unknown as SpaceRegistryInterface;
        room = new ProximityChatRoom(
            "room_1",
            spaceRegistry,
            { newChatMessageWritingStatusStream: new Subject() },
            { getPlayers: () => new Map() } as unknown as RemotePlayersRepository,
            { playBubbleInSound: vi.fn(), playBubbleOutSound: vi.fn() },
            () => undefined
        );
        fake.space.usersStore.set(
            new Map([
                ["room_1", spaceUser("room_1", "Me", "a")],
                ["room_3", spaceUser("room_3", "Sara", "b")],
            ])
        );
        await room.joinSpace("bubble", []);
    });

    afterEach(() => {
        room.destroy();
    });

    const last = () => {
        const messages = Array.from(get(room.messages)).filter(
            (message) => !(message as ProximityChatMessage).session
        ) as ProximityChatMessage[];
        return messages[messages.length - 1];
    };

    it.each(["m4a", "weba", "oga"])("shows a note it sends as .%s as a voice note, not as video", (extension) => {
        const name = `Voice message.${extension}`;
        room.sendMessage(
            "",
            "proximity",
            true,
            `https://uploader.test/upload-file/abc.${extension}`,
            "file",
            "audio/x",
            undefined,
            name
        );

        expect(last().type).toBe("audio");
        expect(get(last().content).isVoice).toBe(true);
        // The others get the name, which is all that tells a note from an audio file.
        expect(fake.space.emitPublicMessage.mock.calls[0][0].spaceMessage.fileName).toBe(name);
    });

    it("shows a note received as .weba or .oga as a voice note", () => {
        for (const [index, extension] of ["weba", "oga"].entries()) {
            fake.emit("spaceMessage", {
                sender: "room_3",
                spaceMessage: {
                    message: "",
                    name: "Sara",
                    url: `https://uploader.test/upload-file/abc.${extension}`,
                    fileName: `Voice message.${extension}`,
                    id: `2f1c7a52-9b1e-4c55-a1f0-7d3a2b9c0e1${index}`,
                },
            });

            expect(last().type).toBe("audio");
            expect(get(last().content).isVoice).toBe(true);
        }
    });

    it("sends a note's length and shape with it, and shows them on the sender's own bubble", () => {
        room.sendMessage(
            "",
            "proximity",
            true,
            "https://uploader.test/upload-file/abc.m4a",
            "file",
            "audio/mp4",
            undefined,
            "Voice message.m4a",
            undefined,
            undefined,
            { duration: 4.2, waveform: [0.1, 0.5, 1, 0.3] }
        );

        const sent = fake.space.emitPublicMessage.mock.calls[0][0].spaceMessage;
        expect(sent.voiceDurationMs).toBe(4200);
        expect(sent.voiceWaveform).toHaveLength(100);
        expect(Math.max(...sent.voiceWaveform)).toBe(1024);
        const content = get(last().content);
        expect(content.voiceDuration).toBe(4.2);
        expect(content.voiceWaveform?.length).toBeGreaterThan(0);
        expect(Math.max(...(content.voiceWaveform ?? []))).toBe(1);
    });

    it("sends no shape with an audio file", () => {
        room.sendMessage(
            "",
            "proximity",
            true,
            "https://uploader.test/upload-file/abc.mp3",
            "file",
            "audio/mpeg",
            undefined,
            "Interview.mp3",
            undefined,
            undefined,
            { duration: 4, waveform: [1] }
        );

        const sent = fake.space.emitPublicMessage.mock.calls[0][0].spaceMessage;
        expect(sent.voiceDurationMs).toBeUndefined();
        expect(sent.voiceWaveform).toEqual([]);
        expect(get(last().content).voiceWaveform).toBeUndefined();
    });

    it("shows the length and shape a received note carries, without reading its file", () => {
        fake.emit("spaceMessage", {
            sender: "room_3",
            spaceMessage: {
                message: "",
                name: "Sara",
                url: "https://uploader.test/upload-file/abc.m4a",
                fileName: "Voice message.m4a",
                voiceDurationMs: 3500,
                voiceWaveform: [0, 512, 1024, 256],
            },
        });

        const content = get(last().content);
        expect(content.voiceDuration).toBe(3.5);
        expect(content.voiceWaveform).toHaveLength(4);
        expect(content.voiceWaveform?.[2]).toBe(1);
    });

    it("reads a received note without a shape from its file, as before", () => {
        fake.emit("spaceMessage", {
            sender: "room_3",
            spaceMessage: {
                message: "",
                name: "Sara",
                url: "https://uploader.test/upload-file/abc.m4a",
                fileName: "Voice message.m4a",
                voiceWaveform: [],
            },
        });

        const content = get(last().content);
        expect(content.voiceDuration).toBeUndefined();
        expect(content.voiceWaveform).toBeUndefined();
    });

    it("keeps an audio file with another name as an audio file", () => {
        fake.emit("spaceMessage", {
            sender: "room_3",
            spaceMessage: {
                message: "",
                name: "Sara",
                url: "https://uploader.test/upload-file/abc.mp3",
                fileName: "Interview.mp3",
            },
        });

        expect(last().type).toBe("audio");
        expect(get(last().content).isVoice).toBe(false);
    });

    it("still reads an .ogg file as video", () => {
        fake.emit("spaceMessage", {
            sender: "room_3",
            spaceMessage: {
                message: "",
                name: "Sara",
                url: "https://uploader.test/upload-file/abc.ogg",
                fileName: "clip.ogg",
            },
        });

        expect(last().type).toBe("video");
    });
});
