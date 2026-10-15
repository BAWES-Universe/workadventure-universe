import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
    // The game reads its settings from window.env when it is loaded.
    (window as unknown as { env: Record<string, unknown> }).env = {
        PUSHER_URL: "http://pusher.example.com",
        PUBLIC_MAP_STORAGE_URL: "http://map-storage.example.com",
    };
    return { initGameConnexion: vi.fn() };
});

vi.mock("../../../Connection/ConnectionManager", () => ({
    connectionManager: { initGameConnexion: mocks.initGameConnexion },
}));
vi.mock("../GameScene", () => ({ GameScene: class {} }));
vi.mock("../../../Chat/Connection/Matrix/MatrixChatConnection", () => ({ MatrixChatConnection: class {} }));
vi.mock("../../../Chat/Connection/Matrix/MatrixClientWrapper", () => ({
    InvalidLoginTokenError: class extends Error {},
    MatrixClientWrapper: class {},
}));
vi.mock("../../../Chat/Stores/ChatStore", () => ({ initializeChatVisibilitySubscription: vi.fn() }));
vi.mock("../../../Chat/Stores/ProximitySessionStore", () => ({ keepOnlyProximityHistory: vi.fn() }));
vi.mock("../../Login/EnableCameraScene", () => ({ EnableCameraSceneName: "enableCameraScene" }));
vi.mock("../../Login/LoginScene", () => ({ LoginSceneName: "loginScene" }));
vi.mock("../../Login/SelectCharacterScene", () => ({ SelectCharacterSceneName: "selectCharacterScene" }));
vi.mock("../../Login/SelectCompanionScene", () => ({ SelectCompanionSceneName: "selectCompanionScene" }));
vi.mock("../../Login/EmptyScene", () => ({ EmptySceneName: "emptyScene" }));

import { gameManager } from "../GameManager";

// /login (and a room that needs sign-in) only forwards to the sign-in page. Kept in the history, Back from the sign-in
// page landed on it and it forwarded again, so the player could never get back to the room. #986
describe("the page that forwards to sign-in", () => {
    const assign = vi.fn();
    const replace = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        Object.defineProperty(window, "location", {
            value: { ...window.location, assign, replace },
            configurable: true,
        });
    });

    it("is replaced by the sign-in page, not kept in the history", async () => {
        const signIn = new URL("http://pusher.example.com/login-screen?playUri=room&manuallyTriggered=true");
        mocks.initGameConnexion.mockResolvedValue(signIn);

        const scene = await gameManager.init({} as Phaser.Scenes.ScenePlugin);

        expect(replace).toHaveBeenCalledWith(signIn.toString());
        expect(assign).not.toHaveBeenCalled();
        expect(scene).toBe("emptyScene");
    });
});
