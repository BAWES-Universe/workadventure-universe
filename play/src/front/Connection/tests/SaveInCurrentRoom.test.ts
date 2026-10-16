import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
    // The game reads its settings from window.env when it is loaded.
    (window as unknown as { env: Record<string, unknown> }).env = {
        PUSHER_URL: "http://pusher.example.com",
        PUBLIC_MAP_STORAGE_URL: "http://map-storage.example.com",
    };
    return { post: vi.fn() };
});

vi.mock("../AxiosUtils", () => ({
    axiosToPusher: { post: mocks.post, get: vi.fn() },
    axiosWithRetry: {},
}));
vi.mock("../Capabilities", () => ({ hasCapability: () => true }));
vi.mock("../../Phaser/Game/GameManager", () => ({ gameManager: {} }));
vi.mock("../../Administration/AnalyticsClient", () => ({ analyticsClient: {} }));
vi.mock("../../Url/UrlManager", () => ({ GameConnexionTypes: {}, urlManager: {} }));
vi.mock("../../Network/ServiceWorker", () => ({ _ServiceWorker: class {} }));
vi.mock("../../Chat/Utils", () => ({ openChatRoom: vi.fn() }));
vi.mock("../../external-modules/admin-api/orbitAccessToken", () => ({ gameTokenToJoinWith: vi.fn() }));
vi.mock("../RoomConnection", () => ({ RoomConnection: class {} }));
vi.mock("../Room", () => ({ Room: class {} }));
vi.mock("../ConnectAttemptWatch", () => ({ watchConnectAttempt: vi.fn() }));
vi.mock("../../WebRtc/HtmlUtils", () => ({ HtmlUtils: {} }));

import { connectionManager } from "../ConnectionManager";
import { localUserStore } from "../LocalUserStore";
import type { Room } from "../Room";

/** A game token as the store reads it: three parts, the middle one a JSON payload. */
function gameToken(payload: object): string {
    return `header.${window.btoa(JSON.stringify(payload))}.signature`;
}

const DEFAULT_WORLD = "https://play.example.com/@/default/hub/lobby";
const OTHER_UNIVERSE = "https://play.example.com/@/studio/film/stage";

/** The part of a room the saves read. */
function room(key: string): Room {
    return { key } as unknown as Room;
}

/** The room address of the last save sent to the server. */
function lastRoomUrl(): string {
    const [, body] = mocks.post.mock.calls[mocks.post.mock.calls.length - 1] as [string, { roomUrl: string }];
    return body.roomUrl;
}

// The page loads once. Walking through an exit, or the Explore list, starts another map without reloading it, and
// Orbit saves a pick for the world of the room it is told about. #843
describe("saves from the room the player is in", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.post.mockResolvedValue({});
        (connectionManager as unknown as { authToken: string }).authToken = "token";
        // A signed-in player: the name is kept on their account.
        localUserStore.setAuthToken(gameToken({ accessToken: "access" }));
    });

    it.each([
        ["saveTextures", () => connectionManager.saveTextures(["body"]), "saved"],
        ["saveName", () => connectionManager.saveName("Ali"), true],
        ["saveCompanionTexture", () => connectionManager.saveCompanionTexture("dog"), "saved"],
    ])("%s: sends the room of the latest map, not the first one", async (_name, save, ok) => {
        connectionManager.setCurrentRoom(room(DEFAULT_WORLD));
        expect(await save()).toBe(ok);
        expect(lastRoomUrl()).toBe(DEFAULT_WORLD);

        // The player walks into a world of another universe: the page is not reloaded.
        connectionManager.setCurrentRoom(room(OTHER_UNIVERSE));
        expect(await save()).toBe(ok);
        expect(lastRoomUrl()).toBe(OTHER_UNIVERSE);
    });
});

// The play server saves nothing for a guest yet answers "saved", so the name has to stay on the device. #884
describe("a guest's name", () => {
    it("is not sent to the server, so the game keeps it on the device", async () => {
        vi.clearAllMocks();
        (connectionManager as unknown as { authToken: string }).authToken = "token";
        localUserStore.setAuthToken(gameToken({}));
        connectionManager.setCurrentRoom(room(DEFAULT_WORLD));

        expect(await connectionManager.saveName("Ali")).toBe(false);
        expect(mocks.post).not.toHaveBeenCalled();
    });
});
