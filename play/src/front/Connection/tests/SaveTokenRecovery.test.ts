import { beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

const mocks = vi.hoisted(() => {
    // The game reads its settings from window.env when it is loaded.
    (window as unknown as { env: Record<string, unknown> }).env = {
        PUSHER_URL: "http://pusher.example.com",
        PUBLIC_MAP_STORAGE_URL: "http://map-storage.example.com",
    };
    return { post: vi.fn(), get: vi.fn() };
});

vi.mock("../AxiosUtils", () => ({
    axiosToPusher: { post: mocks.post, get: mocks.get },
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

/** A game token as the store reads it: three parts, the middle one a JSON payload. Signed in when it has an access token. */
function gameToken(label: string, signedIn: boolean): string {
    return `header.${window.btoa(JSON.stringify(signedIn ? { label, accessToken: "access" } : { label }))}.signature`;
}

/** What axios throws for a response with a status. */
function httpError(status: number) {
    return Object.assign(new Error(`Request failed with status code ${status}`), {
        isAxiosError: true,
        response: { status },
    });
}

// The name save answers true or false; the WOKA and the companion saves say what happened (saved, refused, failed).
const SAVES: [string, () => Promise<unknown>, unknown][] = [
    ["saveName", () => connectionManager.saveName("Ali"), false],
    ["saveTextures", () => connectionManager.saveTextures(["body"]), "failed"],
    ["saveCompanionTexture", () => connectionManager.saveCompanionTexture("dog"), "failed"],
];

const SIGN_IN = new URL("http://pusher.example.com/login-screen?playUri=room");

// A 401 from a save means the game token was refused (missing, no longer valid, or past its 30 days), and /me refuses
// that token too, so there is nothing to renew: a signed-in player signs in again. #945
describe("a save that gets a 401", () => {
    const assign = vi.fn();
    let signIn: MockInstance<typeof connectionManager.loadOpenIDScreen>;

    beforeEach(() => {
        vi.clearAllMocks();
        // A save that never posts (a guest's name) leaves its answer queued: drop it
        mocks.post.mockReset();
        mocks.get.mockReset();
        Object.defineProperty(window, "location", { value: { ...window.location, assign }, configurable: true });
        signIn = vi.spyOn(connectionManager, "loadOpenIDScreen").mockReturnValue(SIGN_IN);
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        vi.spyOn(console, "error").mockImplementation(() => undefined);
    });

    function as(signedIn: boolean) {
        const token = gameToken("old", signedIn);
        (connectionManager as unknown as { authToken: string }).authToken = token;
        localUserStore.setAuthToken(token);
    }

    it.each(SAVES)("%s: sends a signed-in player to sign in again, back to this room", async (_name, save, failed) => {
        as(true);
        mocks.post.mockRejectedValueOnce(httpError(401));

        expect(await save()).toBe(failed);

        expect(signIn).toHaveBeenCalledWith(false);
        expect(assign).toHaveBeenCalledWith(SIGN_IN.toString());
        // Nothing to renew: /me is not asked and the save is not tried again
        expect(mocks.get).not.toHaveBeenCalled();
        expect(mocks.post).toHaveBeenCalledTimes(1);
    });

    it.each(SAVES)("%s: a guest's save just did not happen, nothing else", async (name, save, failed) => {
        as(false);
        mocks.post.mockRejectedValueOnce(httpError(401));

        // A guest's name is not saved on the server at all
        if (name === "saveName") {
            expect(await save()).toBe(false);
            expect(mocks.post).not.toHaveBeenCalled();
            return;
        }
        expect(await save()).toBe(failed);

        expect(signIn).not.toHaveBeenCalled();
        expect(assign).not.toHaveBeenCalled();
        expect(mocks.get).not.toHaveBeenCalled();
    });

    it.each(SAVES)("%s: any other error does not send anyone to sign in", async (_name, save, failed) => {
        as(true);
        mocks.post.mockRejectedValueOnce(httpError(502));

        expect(await save()).toBe(failed);

        expect(signIn).not.toHaveBeenCalled();
        expect(assign).not.toHaveBeenCalled();
    });
});
