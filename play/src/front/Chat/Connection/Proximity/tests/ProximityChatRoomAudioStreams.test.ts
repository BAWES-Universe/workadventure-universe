import { Subject } from "rxjs";
import { get, writable } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProximityChatRoom } from "../ProximityChatRoom";
import type { SpaceInterface, SpaceUserExtended } from "../../../../Space/SpaceInterface";
import type { SpaceRegistryInterface } from "../../../../Space/SpaceRegistry/SpaceRegistryInterface";
import type { RemotePlayersRepository } from "../../../../Phaser/Game/RemotePlayersRepository";

// The front reads its configuration from window.env at import time.
// The answerer registry mirrors IframeListener: registering a key twice throws.
const answerers = vi.hoisted(() => {
    (window as unknown as { env: Record<string, unknown> }).env = {};
    const registered = new Set<string>();
    return {
        registered,
        register(key: string): void {
            if (registered.has(key)) {
                throw new Error(`Answerer for key ${key} already registered`);
            }
            registered.add(key);
        },
        unregister(key: string): void {
            registered.delete(key);
        },
    };
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
            registerAnswerer: (key: string) => answerers.register(key),
            unregisterAnswerer: (key: string) => answerers.unregister(key),
        },
    };
});

vi.mock("../../../../Notification/NotificationManager", () => {
    return {
        notificationManager: {
            createNotification: () => undefined,
        },
    };
});

// Same answerer lifecycle as the real manager: registered on construction, unregistered on close.
vi.mock("../../../../WebRtc/AudioStream/ScriptingOutputAudioStreamManager", () => {
    const keys = ["startStreamInBubble", "appendPCMData", "stopStreamInBubble", "resetAudioBuffer"];
    return {
        ScriptingOutputAudioStreamManager: class {
            constructor() {
                for (const key of keys) {
                    answerers.register(key);
                }
            }
            close(): void {
                for (const key of keys) {
                    answerers.unregister(key);
                }
            }
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

function createFakeSpace(name: string) {
    const space = {
        destroyed: false,
        usersStore: writable(new Map<string, SpaceUserExtended>()),
        observeUserJoined: new Subject<SpaceUserExtended>(),
        observeUserLeft: new Subject<SpaceUserExtended>(),
        onLeaveSpace: new Subject<void>(),
        observePublicEvent: () => new Subject().asObservable(),
        observePrivateEvent: () => new Subject().asObservable(),
        emitPublicMessage: vi.fn(),
        getName: () => name,
        getUsers: () => Promise.resolve(get(space.usersStore)),
    };
    return space;
}

describe("ProximityChatRoom scripting audio streams", () => {
    let room: ProximityChatRoom;
    let nextSpace: ReturnType<typeof createFakeSpace>;

    beforeEach(() => {
        answerers.registered.clear();
        const spaceRegistry = {
            joinSpace: () => Promise.resolve(nextSpace as unknown as SpaceInterface),
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
    });

    afterEach(() => {
        room.destroy();
    });

    it("rejoins a space destroyed outside leaveSpace without registering answerers twice", async () => {
        const first = createFakeSpace("area__speakerzone");
        nextSpace = first;
        await room.joinSpace("area__speakerzone", [], true);
        expect(answerers.registered.has("startStreamInBubble")).toBe(true);

        // The space is left directly through the registry (e.g. the non-chat megaphone path):
        // ProximityChatRoom.leaveSpace() never runs.
        first.destroyed = true;

        nextSpace = createFakeSpace("area__speakerzone");
        await expect(room.joinSpace("area__speakerzone", [], true)).resolves.toBeUndefined();
        expect(answerers.registered.has("startStreamInBubble")).toBe(true);
    });

    it("unregisters answerers when leaving the space", async () => {
        nextSpace = createFakeSpace("bubble");
        await room.joinSpace("bubble", [], true);
        await room.leaveSpace("bubble", true);
        expect(answerers.registered.size).toBe(0);
    });
});
