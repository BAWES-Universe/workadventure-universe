import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
    // The game reads its settings from window.env when it is loaded.
    (window as unknown as { env: Record<string, unknown> }).env = {
        PUSHER_URL: "http://pusher.example.com",
        PUBLIC_MAP_STORAGE_URL: "http://map-storage.example.com",
        MAX_USERNAME_LENGTH: 25,
    };
    return { me: vi.fn(), setPlayerName: vi.fn() };
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
    analyticsClient: { identifyUser: vi.fn(), loggedWithToken: vi.fn(), loggedWithSso: vi.fn() },
}));
vi.mock("../../Network/ServiceWorker", () => ({ _ServiceWorker: class {} }));
vi.mock("../../Chat/Utils", () => ({ openChatRoom: vi.fn() }));
vi.mock("../../external-modules/admin-api/orbitAccessToken", () => ({ gameTokenToJoinWith: vi.fn() }));
vi.mock("../RoomConnection", () => ({ RoomConnection: class {} }));
vi.mock("../ConnectAttemptWatch", () => ({ watchConnectAttempt: vi.fn() }));

import { connectionManager } from "../ConnectionManager";
import { localUserStore } from "../LocalUserStore";

// A signed-in player's game token: three parts, the middle one a JSON payload carrying an access token
const gameToken = `header.${window.btoa(JSON.stringify({ identifier: "uuid-me", accessToken: "access" }))}.signature`;

const meAnswer = (username?: string, usernameFromAccount = username !== undefined) => ({
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

// A device kept the name it was first given ("test", "K") while the account was renamed elsewhere, and showed it
// again whenever Orbit's answer came without a name. #1192
describe("the account's name on this device", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        localUserStore.setName("test");
    });

    it("replaces an older name the device held with the account's name", async () => {
        mocks.me.mockResolvedValue(meAnswer("Khalid"));
        await openTheGame();
        expect(mocks.setPlayerName).toHaveBeenCalledWith("Khalid");
        expect(localStorage.getItem("playerName")).toBe("Khalid");
    });

    it("keeps the account's newer name over the older one from sign-in when Orbit didn't give a name", async () => {
        mocks.me.mockResolvedValue(meAnswer("Khalid"));
        await openTheGame();
        // Orbit couldn't be asked this time: the answer only has the name the game token carried from sign-in.
        mocks.me.mockResolvedValue(meAnswer("K", false));
        await openTheGame();
        expect(mocks.setPlayerName).toHaveBeenLastCalledWith("Khalid");
        expect(localStorage.getItem("playerName")).toBe("Khalid");
    });

    it("doesn't use another account's name the device kept when Orbit didn't give a name", async () => {
        mocks.me.mockResolvedValue(meAnswer("Khalid"));
        await openTheGame();
        mocks.me.mockResolvedValue({ data: { ...meAnswer("Nova", false).data, userUuid: "uuid-someone-else" } });
        await openTheGame();
        expect(mocks.setPlayerName).toHaveBeenLastCalledWith("Nova");
        expect(localStorage.getItem("playerName")).toBe("Khalid");
    });

    it("keeps the device's name when the answer has none (control)", async () => {
        mocks.me.mockResolvedValue(meAnswer(undefined));
        await openTheGame();
        expect(mocks.setPlayerName).not.toHaveBeenCalled();
        expect(localStorage.getItem("playerName")).toBe("test");
    });
});

// Keeping the account's name on the device must not hand it to the next guest there after signing out.
describe("signing out", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        // Forget the name an earlier test left in memory
        localUserStore.setName("earlier test", true);
        localUserStore.restoreGuestName();
        // On a guest's game token, as before signing in
        localUserStore.setAuthToken(`header.${window.btoa(JSON.stringify({ identifier: "guest" }))}.signature`);
    });

    it("gives the device back the name the guest had before signing in", async () => {
        localUserStore.setName("Nova");
        connectionManager.goToSignIn();
        mocks.me.mockResolvedValue(meAnswer("Khalid"));
        await openTheGame();
        expect(localUserStore.getName()).toBe("Khalid");

        connectionManager.logout();
        expect(localUserStore.getName()).toBe("Nova");
    });

    it("doesn't hand a name of unknown origin to the next guest (a device from before the name was marked)", async () => {
        // An older version stored this name; it may have been the account's, and nothing says it was typed by a guest.
        localStorage.setItem("playerName", "Khalid");
        connectionManager.goToSignIn();
        mocks.me.mockResolvedValue(meAnswer("Khalid"));
        await openTheGame();
        connectionManager.logout();
        expect(localUserStore.getName()).toBeNull();
        expect(localStorage.getItem("playerName")).toBeNull();
    });

    it("keeps a guest's own name when a guest is logged out (a refused token)", () => {
        localUserStore.setName("Nova");
        connectionManager.logout();
        expect(localUserStore.getName()).toBe("Nova");
        expect(localStorage.getItem("playerName")).toBe("Nova");
    });

    it("leaves no name when there was no guest name before", async () => {
        mocks.me.mockResolvedValue(meAnswer("Khalid"));
        await openTheGame();
        connectionManager.logout();
        expect(localUserStore.getName()).toBeNull();
        expect(localStorage.getItem("playerName")).toBeNull();
    });

    it("doesn't keep the account's name as a guest's once a refused sign-in carried on as a guest", async () => {
        mocks.me.mockResolvedValue(meAnswer("Khalid"));
        await openTheGame();
        // The sign-in was refused later and the game went on with a guest's token, keeping the name it had.
        localUserStore.setAuthToken(`header.${window.btoa(JSON.stringify({ identifier: "guest-2" }))}.signature`);
        connectionManager.goToSignIn();
        connectionManager.logout();
        expect(localUserStore.getName()).toBeNull();
    });

    it("doesn't keep the account's name as a guest's when the page never took in the refused signed-in token", () => {
        // A new page on a signed-in token that /me refused: this page never set it, so it doesn't count as signed in.
        localUserStore.setName("Khalid", true);
        connectionManager.loadOpenIDScreen(false);
        connectionManager.logout();
        expect(localUserStore.getName()).toBeNull();
    });

    it("doesn't keep the account's name as a guest's when a signed-in player is sent to sign in again", async () => {
        mocks.me.mockResolvedValue(meAnswer("Khalid"));
        await openTheGame();
        connectionManager.goToSignIn();
        connectionManager.logout();
        expect(localUserStore.getName()).toBeNull();
    });
});
