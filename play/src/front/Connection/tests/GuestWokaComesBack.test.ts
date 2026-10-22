import { AxiosError } from "axios";
import type { AxiosResponse } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
    // The game reads its settings from window.env when it is loaded.
    (window as unknown as { env: Record<string, unknown> }).env = {
        PUSHER_URL: "http://pusher.example.com",
        PUBLIC_MAP_STORAGE_URL: "http://map-storage.example.com",
    };
    return { anonymLogin: vi.fn(), setCharacterTextureIds: vi.fn(), setPlayerName: vi.fn() };
});

vi.mock("../AxiosUtils", () => ({
    axiosToPusher: {},
    axiosWithRetry: { post: mocks.anonymLogin },
}));
vi.mock("../Capabilities", () => ({ hasCapability: () => true }));
vi.mock("../../Phaser/Game/GameManager", () => ({
    gameManager: { setCharacterTextureIds: mocks.setCharacterTextureIds, setPlayerName: mocks.setPlayerName },
}));
vi.mock("../../Administration/AnalyticsClient", () => ({ analyticsClient: { identifyUser: vi.fn() } }));
vi.mock("../../Url/UrlManager", () => ({
    GameConnexionTypes: { room: "room", empty: "empty", login: "login", jwt: "jwt", register: "register" },
    urlManager: { getGameConnexionType: () => "room" },
}));
vi.mock("../../Network/ServiceWorker", () => ({ _ServiceWorker: class {} }));
vi.mock("../../Chat/Utils", () => ({ openChatRoom: vi.fn() }));
vi.mock("../../external-modules/admin-api/orbitAccessToken", () => ({ gameTokenToJoinWith: vi.fn() }));
vi.mock("../RoomConnection", () => ({ RoomConnection: class {} }));
vi.mock("../Room", () => ({
    Room: { createRoom: () => Promise.resolve({ authenticationMandatory: false, expireOn: undefined }) },
}));
vi.mock("../ConnectAttemptWatch", () => ({ watchConnectAttempt: vi.fn() }));
vi.mock("../../WebRtc/HtmlUtils", () => ({ HtmlUtils: { getElementByIdOrFail: () => ({ value: "" }) } }));

import { connectionManager } from "../ConnectionManager";
import { localUserStore } from "../LocalUserStore";

const GUEST_WOKA = ["male3", "hair5"];

// Sign in clears the woka on the device and keeps the guest's aside. A guest who backs out comes back on a new page,
// where the game read the device (empty) before the woka was put back: it joined with no woka, the world refused it and
// the "can't be worn here" popup showed an empty WOKA. #987
describe("a guest back from an abandoned sign-in", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        // A guest's game token: three parts, the middle one a JSON payload with no access token
        const authToken = `header.${window.btoa(JSON.stringify({ identifier: "guest-uuid" }))}.signature`;
        mocks.anonymLogin.mockResolvedValue({ data: { userUuid: "guest-uuid", email: null, authToken } });
    });

    it("joins wearing the woka they had, without the picker", async () => {
        localUserStore.setCharacterTextures(GUEST_WOKA);
        // What tapping Sign in does to the device
        localUserStore.backupGuestCharacterTextures();
        localUserStore.setCharacterTextures([]);

        const result = await connectionManager.initGameConnexion();

        expect(result).toMatchObject({ nextScene: "gameScene" });
        expect(mocks.setCharacterTextureIds).toHaveBeenCalledWith(GUEST_WOKA);
        expect(localUserStore.getCharacterTextures()).toEqual(GUEST_WOKA);
    });

    it("picks a woka first when there was none to put back", async () => {
        const result = await connectionManager.initGameConnexion();

        expect(result).toMatchObject({ nextScene: "selectCharacterScene" });
        expect(mocks.setCharacterTextureIds).not.toHaveBeenCalled();
    });
});

// A sign-in that is refused (the token is no longer valid) leaves the player a guest on a device that still holds the
// account's name: it must not stay as the guest's name (#1284).
describe("a guest whose sign-in was refused at the start", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        const authToken = `header.${window.btoa(JSON.stringify({ identifier: "guest-uuid" }))}.signature`;
        mocks.anonymLogin.mockResolvedValue({ data: { userUuid: "guest-uuid", email: null, authToken } });
        localUserStore.setAuthToken("expired-account-token");
        vi.spyOn(
            connectionManager as unknown as { checkAuthUserConnexion: () => Promise<never> },
            "checkAuthUserConnexion"
        ).mockRejectedValue(
            new AxiosError("Unauthorized", "ERR_BAD_REQUEST", undefined, undefined, {
                status: 401,
            } as AxiosResponse)
        );
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("does not keep the account's name as their own", async () => {
        localUserStore.setName("Ada Account", true);

        await connectionManager.initGameConnexion();

        expect(localUserStore.getName()).toBeNull();
        // And the game, which read the name when the page started, no longer holds it
        expect(mocks.setPlayerName).toHaveBeenCalledWith(null);
    });

    it("keeps a name they typed themselves", async () => {
        localUserStore.setName("Guesty");

        await connectionManager.initGameConnexion();

        expect(localUserStore.getName()).toBe("Guesty");
        expect(mocks.setPlayerName).toHaveBeenCalledWith("Guesty");
    });

    it("does not keep a name an older version stored, which nothing says a guest typed (#1290)", async () => {
        // What an older version left: the name, without a mark and without the "guest typed it" note.
        localUserStore.setName("Ada Legacy");
        localStorage.removeItem("guestTypedPlayerName");

        await connectionManager.initGameConnexion();

        expect(localUserStore.getName()).toBeNull();
        expect(mocks.setPlayerName).toHaveBeenCalledWith(null);
    });
});

// Back as a guest from a sign-in that was abandoned after the token was cleared, on a device that holds an account's
// name (#1286).
describe("a guest back from an abandoned sign-in, on a device that kept an account's name", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        const authToken = `header.${window.btoa(JSON.stringify({ identifier: "guest-uuid" }))}.signature`;
        mocks.anonymLogin.mockResolvedValue({ data: { userUuid: "guest-uuid", email: null, authToken } });
    });

    it("does not carry on under the account's name", async () => {
        localUserStore.setName("Ada Account", true);
        localUserStore.setAuthToken(null);

        await connectionManager.initGameConnexion();

        expect(localUserStore.getName()).toBeNull();
        expect(mocks.setPlayerName).toHaveBeenCalledWith(null);
    });

    it("keeps a name the guest typed", async () => {
        localUserStore.setName("Guesty");
        localUserStore.setAuthToken(null);

        await connectionManager.initGameConnexion();

        expect(localUserStore.getName()).toBe("Guesty");
        expect(mocks.setPlayerName).toHaveBeenCalledWith("Guesty");
    });

    it("keeps a name an older version stored for a guest who never signed in (#1290)", async () => {
        localUserStore.setName("Old Guest");
        localStorage.removeItem("guestTypedPlayerName");
        localUserStore.setAuthToken(null);

        await connectionManager.initGameConnexion();

        expect(localUserStore.getName()).toBe("Old Guest");
        expect(mocks.setPlayerName).toHaveBeenCalledWith("Old Guest");
    });
});
