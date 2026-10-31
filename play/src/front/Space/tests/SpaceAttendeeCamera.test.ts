import * as Phaser from "phaser";
globalThis.Phaser = Phaser;

import { describe, expect, it, vi } from "vitest";
import { FilterType } from "@workadventure/messages";
import { get, writable } from "svelte/store";
import type { RoomConnection } from "../../Connection/RoomConnection";
import { Space } from "../Space";
import type { SpaceUserExtended } from "../SpaceInterface";

const emitUpdateSpaceUserMessage = vi.fn();
const defaultRoomConnectionMock = {
    emitUserJoinSpace: vi.fn(),
    emitAddSpaceFilter: vi.fn(),
    emitJoinSpace: vi.fn(),
    emitRemoveSpaceFilter: vi.fn(),
    emitUpdateSpaceUserMessage,
} as unknown as RoomConnection;

// const defaultPeerStoreMock = {
//     getSpaceStore: vi.fn(),
//     removePeer: vi.fn(),
//     getPeer: vi.fn(),
// };

// Mock the entire GameManager module
vi.mock("../../Phaser/Game/GameManager", () => ({
    gameManager: {
        getCurrentGameScene: vi.fn(() => ({
            getRemotePlayersRepository: () => ({
                getPlayer: vi.fn(),
            }),
            roomUrl: "test-room",
        })),
    },
}));

// Mock SimplePeer
vi.mock("../../WebRtc/SimplePeer", () => ({
    SimplePeer: vi.fn().mockImplementation(() => ({
        closeAllConnections: vi.fn(),
        destroy: vi.fn(),
    })),
}));

vi.mock("../../Stores/ScreenSharingStore", () => {
    const requested = writable(false);
    return {
        requestedScreenSharingState: {
            subscribe: requested.subscribe,
            enableScreenSharing: () => requested.set(true),
            disableScreenSharing: () => requested.set(false),
        },
        screenSharingLocalStreamStore: writable({ type: "success" }),
        screenSharingConstraintsStore: writable({ video: false, audio: false }),
        screenSharingAvailableStore: writable(false),
        screenShareBandwidthStore: {
            subscribe: writable<number | "unlimited">(0).subscribe,
            setBandwidth: vi.fn(),
        },
        screenSharingLocalMedia: writable(undefined),
    };
});

vi.mock("../../Stores/MegaphoneStore", () => {
    return {
        liveStreamingEnabledStore: writable(false),
        requestedMegaphoneStore: writable(false),
        megaphoneSpaceStore: writable(undefined),
        megaphoneCanBeUsedStore: writable(false),
    };
});

vi.mock("../../Stores/MenuStore", () => {
    return {
        menuIconVisiblilityStore: writable(false),
        menuVisiblilityStore: writable(false),
        screenSharingActivatedStore: writable(false),
        inviteUserActivated: writable(false),
        mapEditorActivated: writable(false),
        roomListActivated: writable(false),
    };
});

vi.mock("../../WebRtc/MediaManager", () => {
    return {
        MediaManager: vi.fn(),
        mediaManager: {
            enableMyCamera: vi.fn(),
            disableMyCamera: vi.fn(),
            enableMyMicrophone: vi.fn(),
            disableMyMicrophone: vi.fn(),
            enableProximityMeeting: vi.fn(),
            disableProximityMeeting: vi.fn(),
        },
    };
});

vi.mock("../../Stores/MediaStore", async (importOriginal) => {
    const actual: object = await importOriginal();
    return {
        ...actual,
        isSpeakerStore: writable(false),
    };
});

vi.mock("../../Enum/EnvironmentVariable.ts", () => {
    return {
        MATRIX_ADMIN_USER: "admin",
        MATRIX_DOMAIN: "domain",
        STUN_SERVER: "stun:test.com:19302",
        TURN_SERVER: "turn:test.com:19302",
        TURN_USER: "user",
        TURN_PASSWORD: "password",
        POSTHOG_API_KEY: "test-api-key",
        POSTHOG_URL: "https://test.com",
        MAX_USERNAME_LENGTH: 10,
        PEER_SCREEN_SHARE_RECOMMENDED_BANDWIDTH: 1000,
        PEER_VIDEO_RECOMMENDED_BANDWIDTH: 1000,
        PUSHER_URL: "http://localhost",
        FALLBACK_LOCALE: "en-US",
        ENABLE_CHAT: true,
        KLAXOON_ENABLED: false,
        KLAXOON_CLIENT_ID: "",
        YOUTUBE_ENABLED: false,
        GOOGLE_DRIVE_ENABLED: false,
        GOOGLE_DOCS_ENABLED: false,
        GOOGLE_SHEETS_ENABLED: false,
        GOOGLE_SLIDES_ENABLED: false,
        ERASER_ENABLED: false,
        EXCALIDRAW_ENABLED: false,
        EXCALIDRAW_DOMAINS: [],
        CARDS_ENABLED: false,
        TLDRAW_ENABLED: false,
    };
});

const signal = new AbortController().signal;

async function stageSpace() {
    return Space.create("stage", FilterType.LIVE_STREAMING_USERS, defaultRoomConnectionMock, ["cameraState"], signal, {
        metadata: new Map<string, unknown>(),
    });
}

const attendee = (spaceUserId: string, attendeeCamera: boolean) =>
    ({ spaceUserId, name: spaceUserId, megaphoneState: false, attendeeCamera } as unknown as SpaceUserExtended);

describe("Space: the speakers see the audience's cameras (#1623)", () => {
    it("gives a speaker a video box for each attendee showing their camera, and takes it away when it goes off", async () => {
        const space = await stageSpace();
        space.startStreaming();

        space.addUser(attendee("alice", true));
        space.addUser(attendee("bob", false));
        expect([...get(space.videoStreamStore).keys()]).toEqual(["alice"]);
        expect(space.getSpaceUserBySpaceUserId("alice")?.name).toBe("alice");
        expect(space.getSpaceUserBySpaceUserId("bob")).toBeUndefined();

        space.updateUserData({ spaceUserId: "alice", attendeeCamera: false } as never, ["attendeeCamera"]);
        expect(get(space.videoStreamStore).size).toBe(0);
        expect(space.getSpaceUserBySpaceUserId("alice")).toBeUndefined();

        space.updateUserData({ spaceUserId: "bob", attendeeCamera: true } as never, ["attendeeCamera"]);
        expect([...get(space.videoStreamStore).keys()]).toEqual(["bob"]);

        space.removeUser("bob");
        expect(get(space.videoStreamStore).size).toBe(0);
    });

    it("shows no attendee to someone in the audience", async () => {
        const space = await stageSpace();

        space.addUser(attendee("alice", true));
        expect(get(space.videoStreamStore).size).toBe(0);
        expect(space.getSpaceUserBySpaceUserId("alice")).toBeUndefined();
    });

    it("shows the attendees to someone who starts streaming, and hides them when they stop", async () => {
        const space = await stageSpace();
        space.addUser(attendee("alice", true));

        space.startStreaming();
        expect([...get(space.videoStreamStore).keys()]).toEqual(["alice"]);

        space.stopStreaming();
        expect(get(space.videoStreamStore).size).toBe(0);
    });

    it("tells the others once when we start or stop showing our camera", async () => {
        const space = await stageSpace();
        emitUpdateSpaceUserMessage.mockClear();

        space.showCameraToStreamers(true);
        space.showCameraToStreamers(true);
        space.showCameraToStreamers(false);

        expect(emitUpdateSpaceUserMessage.mock.calls.map(([, update]) => update)).toEqual([
            { attendeeCamera: true },
            { attendeeCamera: false },
        ]);
        expect(get(space.showsCameraToStreamersStore)).toBe(false);
    });
});
