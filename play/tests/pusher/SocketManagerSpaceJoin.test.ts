import { FilterType } from "@workadventure/messages";
import { describe, expect, it, vi } from "vitest";
import { mock } from "vitest-mock-extended";
import type { Socket } from "../../src/pusher/services/SocketManager";
import { SocketManager } from "../../src/pusher/services/SocketManager";
import type { SpaceConnection } from "../../src/pusher/models/SpaceConnection";
import { SpaceJoinRefusedError } from "../../src/pusher/services/SpaceJoinPolicy";

// The pusher's environment is checked when SocketManager is imported
vi.hoisted(() => {
    process.env.SECRET_KEY ??= "test-secret";
    process.env.API_URL ??= "localhost:50051";
    process.env.MAP_STORAGE_API_TOKEN ??= "test-token";
    process.env.UPLOADER_URL ??= "http://uploader.example.com";
    process.env.ICON_URL ??= "http://icon.example.com";
});

vi.mock("../../src/pusher/services/MatrixProvider", () => ({ matrixProvider: {} }));

function makeSocket(): Socket {
    const data = {
        world: "my-world",
        disconnecting: false,
        spaceUserId: "room_1",
        spaces: new Set<string>(),
        joinSpacesPromise: new Map<string, Promise<void>>(),
        grantedBubbleSpaces: new Set<string>(),
        megaphoneChannels: new Map<string, boolean>(),
    };
    return { getUserData: () => data } as unknown as Socket;
}

describe("SocketManager space joins", () => {
    it("refuses a bubble the back did not ask the player to join, before creating the space", async () => {
        const getSpaceStreamToBackPromise = vi.fn();
        const spaceConnection = mock<SpaceConnection>({ getSpaceStreamToBackPromise });
        const socketManager = new SocketManager(spaceConnection);
        const socket = makeSocket();

        await expect(
            socketManager.handleJoinSpace(
                socket,
                "my-world.http://play.example.com/@/t/w/r#3#1700000000000",
                "http://play.example.com/@/t/w/r#3#1700000000000",
                FilterType.ALL_USERS,
                ["cameraState", "microphoneState", "screenSharingState"],
                { signal: new AbortController().signal }
            )
        ).rejects.toBeInstanceOf(SpaceJoinRefusedError);
        expect(getSpaceStreamToBackPromise).not.toHaveBeenCalled();
        expect(socket.getUserData().spaces.size).toBe(0);
    });

    it("refuses the world space with camera properties", async () => {
        const getSpaceStreamToBackPromise = vi.fn();
        const spaceConnection = mock<SpaceConnection>({ getSpaceStreamToBackPromise });
        const socketManager = new SocketManager(spaceConnection);

        await expect(
            socketManager.handleJoinSpace(
                makeSocket(),
                "my-world.allWorldUser",
                "allWorldUser",
                FilterType.ALL_USERS,
                ["availabilityStatus", "chatID", "cameraState"],
                { signal: new AbortController().signal }
            )
        ).rejects.toBeInstanceOf(SpaceJoinRefusedError);
        expect(getSpaceStreamToBackPromise).not.toHaveBeenCalled();
    });

    it("leaving a space the player is not in does nothing (and reports no error)", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            const socketManager = new SocketManager(mock<SpaceConnection>());
            await expect(socketManager.handleLeaveSpace(makeSocket(), "my-world.some-space")).resolves.toBeUndefined();
            expect(consoleError).not.toHaveBeenCalled();
        } finally {
            consoleError.mockRestore();
        }
    });
});
