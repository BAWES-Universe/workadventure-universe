import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
    // The game reads its settings from window.env when it is loaded.
    (window as unknown as { env: Record<string, unknown> }).env = {
        PUSHER_URL: "http://pusher.example.com",
        PUBLIC_MAP_STORAGE_URL: "http://map-storage.example.com",
    };
    class FakeGameScene {
        constructor(public room: unknown) {}
    }
    return { FakeGameScene };
});

vi.mock("../../../Connection/ConnectionManager", () => ({ connectionManager: {} }));
vi.mock("../GameScene", () => ({ GameScene: mocks.FakeGameScene }));
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

// The page loads once, so currentStartedRoom stays the first room. What the player sees (the Woka catalog) is the
// room of the map they are on. #844
describe("currentMapRoom", () => {
    const firstRoom = { href: "https://play.example.com/@/default/hub/lobby" };
    const otherRoom = { href: "https://play.example.com/@/studio/film/stage" };
    const internals = gameManager as unknown as { startRoom: unknown; scenePlugin: unknown };

    it("is the first room while no other map has started", () => {
        internals.startRoom = firstRoom;
        internals.scenePlugin = { get: () => new mocks.FakeGameScene(firstRoom) };
        expect(gameManager.currentMapRoom).toBe(firstRoom);
    });

    it("follows the player to another map", () => {
        internals.startRoom = firstRoom;
        internals.scenePlugin = { get: () => new mocks.FakeGameScene(otherRoom) };
        expect(gameManager.currentMapRoom).toBe(otherRoom);
        expect(gameManager.currentStartedRoom).toBe(firstRoom);
    });

    it("falls back to the first room while a map change is swapping the scene", () => {
        internals.startRoom = firstRoom;
        internals.scenePlugin = { get: () => undefined };
        expect(gameManager.currentMapRoom).toBe(firstRoom);
    });
});
