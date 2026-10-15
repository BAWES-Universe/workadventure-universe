import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
    // The game reads its settings from window.env when it is loaded.
    (window as unknown as { env: Record<string, unknown> }).env = {
        PUSHER_URL: "http://pusher.example.com",
        PUBLIC_MAP_STORAGE_URL: "http://map-storage.example.com",
    };
    return { post: vi.fn(), get: vi.fn(), hasCapability: vi.fn(), emitPlayerTextures: vi.fn() };
});

vi.mock("../AxiosUtils", () => ({
    axiosToPusher: { post: mocks.post, get: mocks.get },
    axiosWithRetry: {},
}));
vi.mock("../Capabilities", () => ({ hasCapability: mocks.hasCapability }));
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

/** A game token as the store reads it: three parts, the middle one a JSON payload. */
function gameToken(label: string): string {
    return `header.${window.btoa(JSON.stringify({ label }))}.signature`;
}

const OLD_TOKEN = gameToken("old");

/** What axios throws for a response with a status. */
function httpError(status: number, data?: unknown) {
    return Object.assign(new Error(`Request failed with status code ${status}`), {
        isAxiosError: true,
        response: { status, data },
    });
}

const NOT_ALLOWED = httpError(422, { code: "WOKA_NOT_ALLOWED" });

const SAVES: [string, () => Promise<string>][] = [
    ["saveTextures", () => connectionManager.saveTextures(["body"])],
    ["saveCompanionTexture", () => connectionManager.saveCompanionTexture("dog")],
];

describe("what a WOKA or companion save says happened", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.hasCapability.mockReturnValue("v1");
        (connectionManager as unknown as { authToken: string }).authToken = OLD_TOKEN;
        (connectionManager as unknown as { _roomConnection: unknown })._roomConnection = {
            emitPlayerTextures: mocks.emitPlayerTextures,
        };
        localUserStore.setAuthToken(OLD_TOKEN);
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        vi.spyOn(console, "error").mockImplementation(() => undefined);
    });

    it.each(SAVES)("%s: 204 is saved", async (_name, save) => {
        mocks.post.mockResolvedValueOnce({ status: 204 });
        expect(await save()).toBe("saved");
    });

    it.each(SAVES)("%s: 422 WOKA_NOT_ALLOWED is notAllowed", async (_name, save) => {
        mocks.post.mockRejectedValueOnce(NOT_ALLOWED);
        expect(await save()).toBe("notAllowed");
    });

    it.each(SAVES)("%s: a 422 for another reason is failed", async (_name, save) => {
        mocks.post.mockRejectedValueOnce(httpError(422, { code: "OTHER" }));
        expect(await save()).toBe("failed");
    });

    it.each(SAVES)("%s: a 5xx is failed", async (_name, save) => {
        mocks.post.mockRejectedValueOnce(httpError(502));
        expect(await save()).toBe("failed");
    });

    it.each(SAVES)("%s: a network error is failed", async (_name, save) => {
        mocks.post.mockRejectedValueOnce(new Error("Network Error"));
        expect(await save()).toBe("failed");
    });

    // What a 401 does (sign in again) is in SaveTokenRecovery.test.ts
    it.each(SAVES)("%s: a 401 is failed, and is not tried again", async (_name, save) => {
        mocks.post.mockRejectedValueOnce(httpError(401));
        expect(await save()).toBe("failed");
        expect(mocks.post).toHaveBeenCalledTimes(1);
        expect(mocks.get).not.toHaveBeenCalled();
    });

    it.each(SAVES)("%s: a guest (no save capability) is saved: the device keeps it", async (_name, save) => {
        mocks.hasCapability.mockReturnValue(undefined);
        expect(await save()).toBe("saved");
        expect(mocks.post).not.toHaveBeenCalled();
    });

    it("tells the others in the room only once the WOKA is saved", async () => {
        mocks.post.mockRejectedValueOnce(NOT_ALLOWED);
        await connectionManager.saveTextures(["body"]);
        expect(mocks.emitPlayerTextures).not.toHaveBeenCalled();

        mocks.post.mockResolvedValueOnce({ status: 204 });
        await connectionManager.saveTextures(["body"]);
        expect(mocks.emitPlayerTextures).toHaveBeenCalledWith(["body"]);
    });
});
