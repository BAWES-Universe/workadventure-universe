import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
    // The game reads its settings from window.env when it is loaded.
    (window as unknown as { env: Record<string, unknown> }).env = {
        PUSHER_URL: "http://pusher.example.com",
        PUBLIC_MAP_STORAGE_URL: "http://map-storage.example.com",
    };
    return { anonymLogin: vi.fn(), setCharacterTextureIds: vi.fn() };
});

vi.mock("../AxiosUtils", () => ({
    axiosToPusher: {},
    axiosWithRetry: { post: mocks.anonymLogin },
}));
vi.mock("../Capabilities", () => ({ hasCapability: () => true }));
vi.mock("../../Phaser/Game/GameManager", () => ({
    gameManager: { setCharacterTextureIds: mocks.setCharacterTextureIds },
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
