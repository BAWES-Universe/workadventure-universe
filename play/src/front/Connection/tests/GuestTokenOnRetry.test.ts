import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
    // The game reads its settings from window.env when it is loaded.
    (window as unknown as { env: Record<string, unknown> }).env = {
        PUSHER_URL: "http://pusher.example.com",
        PUBLIC_MAP_STORAGE_URL: "http://map-storage.example.com",
        MAX_USERNAME_LENGTH: 25,
    };
    return { me: vi.fn(), setPlayerName: vi.fn(), forgetThisDeviceOnSignOut: vi.fn(() => Promise.resolve()) };
});

vi.mock("../AxiosUtils", () => ({ axiosToPusher: { get: mocks.me }, axiosWithRetry: {} }));
vi.mock("../Capabilities", () => ({ hasCapability: (name: string) => name === "api/save-name" }));
vi.mock("../../Phaser/Game/GameManager", () => ({
    gameManager: {
        setPlayerName: mocks.setPlayerName,
        setCharacterTextureIds: vi.fn(),
        setMatrixServerUrl: vi.fn(),
        setVisitCardUrl: vi.fn(),
    },
}));
vi.mock("../../Administration/AnalyticsClient", () => ({
    analyticsClient: { identifyUser: vi.fn(), forgetPerson: vi.fn(), loggedWithToken: vi.fn(), loggedWithSso: vi.fn() },
}));
vi.mock("../../Network/ServiceWorker", () => ({ _ServiceWorker: class {} }));
vi.mock("../../Chat/Utils", () => ({ openChatRoom: vi.fn() }));
vi.mock("../../external-modules/admin-api/orbitAccessToken", () => ({ gameTokenToJoinWith: vi.fn() }));
vi.mock("../RoomConnection", () => ({ RoomConnection: class {} }));
vi.mock("../ConnectAttemptWatch", () => ({ watchConnectAttempt: vi.fn() }));
vi.mock("../../Notification/Push/PushDevice", () => ({ forgetThisDeviceOnSignOut: mocks.forgetThisDeviceOnSignOut }));

import { connectionManager } from "../ConnectionManager";
import { localUserStore } from "../LocalUserStore";

// A signed-in player's game token: three parts, the middle one a JSON payload carrying an access token
const gameToken = `header.${window.btoa(JSON.stringify({ identifier: "uuid-me", accessToken: "access" }))}.signature`;

const okAnswer = (username?: string, usernameFromAccount = username !== undefined) => ({
    data: {
        status: "ok",
        authToken: gameToken,
        userUuid: "uuid-me",
        email: "me@example.com",
        username,
        usernameFromAccount,
        isCharacterTexturesValid: true,
        isCompanionTextureValid: true,
    },
});

async function openTheGame() {
    const manager = connectionManager as unknown as {
        _currentRoom: unknown;
        checkAuthUserConnexion(token: string): Promise<unknown>;
    };
    manager._currentRoom = { key: "http://play.example.com/@/u/w/r", opidWokaNamePolicy: "user_input" };
    await manager.checkAuthUserConnexion(gameToken);
}

const GUEST = `header.${window.btoa(JSON.stringify({ identifier: "5b522f38-d7d2-4e37-be94-2476cb1efdfe" }))}.signature`;

// Orbit could not keep the guest's chat when the guest signed in: it answers "retry", and the same sign-in is asked again. The guest id has to go
// again with that second request, so it is dropped only once the pusher has signed the person in.
const retryAnswer = {
    data: {
        status: "error",
        type: "retry",
        code: "GUEST_CHAT_NOT_KEPT",
        title: "Please wait",
        subtitle: "Your chat is being kept",
        details: "Trying again",
        timeToRetry: 5000,
        canRetryManual: true,
    },
};

async function signIn(token: string) {
    const manager = connectionManager as unknown as {
        _currentRoom: unknown;
        checkAuthUserConnexion(token: string): Promise<unknown>;
    };
    manager._currentRoom = { key: "http://play.example.com/@/u/w/r", opidWokaNamePolicy: "user_input" };
    return manager.checkAuthUserConnexion(token);
}

const guestTokenOfCall = (call: number) =>
    (mocks.me.mock.calls[call][1] as { params: { guestToken?: string } }).params.guestToken;

describe("the guest id sent along when a guest signs in to an account", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        // The device kept the guest's token aside, and now holds the account's
        localUserStore.setAuthToken(GUEST);
        localUserStore.keepGuestTokenAside();
        localUserStore.setAuthToken(gameToken);
    });

    it("keeps it when Orbit answers with a retry, sends the same one again, and drops it only once signed in", async () => {
        mocks.me.mockResolvedValueOnce(retryAnswer).mockResolvedValueOnce(okAnswer("Khalid"));

        const first = await signIn(gameToken);
        expect(guestTokenOfCall(0)).toBe(GUEST);
        expect(first).toMatchObject({ status: "error", type: "retry", code: "GUEST_CHAT_NOT_KEPT" });
        // The retry error did not sign the person in: the guest id is still there for the next request
        expect(localUserStore.peekGuestTokenAside()).toBe(GUEST);

        await signIn(gameToken);
        expect(mocks.me).toHaveBeenCalledTimes(2);
        expect(guestTokenOfCall(1)).toBe(GUEST);
        // Signed in: it has been sent, so it is removed
        expect(localUserStore.peekGuestTokenAside()).toBeNull();
    });

    it("sends nothing when there is no guest id kept aside", async () => {
        localStorage.clear();
        localUserStore.setAuthToken(gameToken);
        mocks.me.mockResolvedValueOnce(okAnswer("Khalid"));
        await signIn(gameToken);
        expect(guestTokenOfCall(0)).toBeUndefined();
    });
});
