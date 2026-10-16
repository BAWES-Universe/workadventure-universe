import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
    // The game reads its settings from window.env when it is loaded.
    (window as unknown as { env: Record<string, unknown> }).env = {
        PUSHER_URL: "http://pusher.example.com",
        PUBLIC_MAP_STORAGE_URL: "http://map-storage.example.com",
    };
    return { setCurrentRoom: vi.fn() };
});

vi.mock("../../../Connection/ConnectionManager", () => ({
    connectionManager: { setCurrentRoom: mocks.setCurrentRoom },
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

// The page loads once; each map that starts says which room the player is in, so a Woka picked there is saved for it. #843
describe("a map starting", () => {
    it("tells the connection manager which room the player is in", () => {
        const room = { key: "https://play.example.com/@/studio/film/stage" };
        gameManager.gameSceneIsCreated({ scene: { key: room.key }, room } as never);
        expect(mocks.setCurrentRoom).toHaveBeenCalledWith(room);
    });
});
