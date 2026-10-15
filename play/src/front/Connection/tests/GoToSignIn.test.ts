import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
    // The game reads its settings from window.env when it is loaded.
    (window as unknown as { env: Record<string, unknown> }).env = {
        PUSHER_URL: "http://pusher.example.com",
        PUBLIC_MAP_STORAGE_URL: "http://map-storage.example.com",
        ENABLE_OPENID: true,
    };
    return { loggedWithSso: vi.fn() };
});

vi.mock("../AxiosUtils", () => ({ axiosToPusher: {}, axiosWithRetry: {} }));
vi.mock("../Capabilities", () => ({ hasCapability: () => true }));
vi.mock("../../Phaser/Game/GameManager", () => ({ gameManager: {} }));
vi.mock("../../Administration/AnalyticsClient", () => ({
    analyticsClient: { loggedWithSso: mocks.loggedWithSso, loggedWithToken: vi.fn() },
}));
vi.mock("../../Url/UrlManager", () => ({ GameConnexionTypes: {}, urlManager: {} }));
vi.mock("../../Network/ServiceWorker", () => ({ _ServiceWorker: class {} }));
vi.mock("../../Chat/Utils", () => ({ openChatRoom: vi.fn() }));
vi.mock("../../external-modules/admin-api/orbitAccessToken", () => ({ gameTokenToJoinWith: vi.fn() }));
vi.mock("../RoomConnection", () => ({ RoomConnection: class {} }));
vi.mock("../Room", () => ({ Room: class {} }));
vi.mock("../ConnectAttemptWatch", () => ({ watchConnectAttempt: vi.fn() }));
vi.mock("../../WebRtc/HtmlUtils", () => ({ HtmlUtils: {} }));

import { connectionManager } from "../ConnectionManager";
import type { Room } from "../Room";
import { localUserStore } from "../LocalUserStore";

const GUEST_TOKEN = `header.${window.btoa(JSON.stringify({ identifier: "guest-uuid" }))}.signature`;
const GUEST_WOKA = ["male3", "hair5"];
const ROOM_KEY = "http://play.example.com/@/universe/world/lobby";

// The Sign in buttons go straight to the sign-in page from the room the player is in. Through /login, the whole app
// started again behind the loading screen just to forward, and that page stayed under the sign-in page: closing the
// sign-in sheet of the installed iPhone app landed on it, frozen, then empty. #1017
describe("Sign in", () => {
    const assign = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        Object.defineProperty(window, "location", { value: { ...window.location, assign }, configurable: true });
        localUserStore.setAuthToken(GUEST_TOKEN);
        localUserStore.setCharacterTextures(GUEST_WOKA);
    });

    it("opens the sign-in page for the room the player is in, with no stop at /login", () => {
        connectionManager.setCurrentRoom({ key: ROOM_KEY } as Room);

        connectionManager.goToSignIn();

        expect(assign).toHaveBeenCalledTimes(1);
        const url = new URL(assign.mock.calls[0][0] as string);
        expect(url.origin + url.pathname).toBe("http://pusher.example.com/login-screen");
        expect(url.searchParams.get("playUri")).toBe(ROOM_KEY);
        expect(url.searchParams.get("manuallyTriggered")).toBe("true");
        expect(mocks.loggedWithSso).toHaveBeenCalled();
    });

    it("leaves the room as it is, so closing the sign-in page finds it unchanged", () => {
        connectionManager.setCurrentRoom({ key: ROOM_KEY } as Room);

        connectionManager.goToSignIn();

        expect(localUserStore.getAuthToken()).toBe(GUEST_TOKEN);
        expect(localUserStore.getCharacterTextures()).toEqual(GUEST_WOKA);
    });

    it("goes through /login before any room is known", () => {
        (connectionManager as unknown as { _currentRoom: Room | null })._currentRoom = null;

        connectionManager.goToSignIn();

        expect(assign).toHaveBeenCalledWith("/login");
    });
});
