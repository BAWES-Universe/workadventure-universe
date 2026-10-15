import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
    // The game reads its settings from window.env when it is loaded.
    (window as unknown as { env: Record<string, unknown> }).env = {
        PUSHER_URL: "http://pusher.example.com",
        PUBLIC_MAP_STORAGE_URL: "http://map-storage.example.com",
    };
    class FakeGameScene {
        constructor(public room: unknown, public scene = { key: "next" }) {}
        hasProximityChatRoom = true;
        cleanupClosingScene = vi.fn();
        createSuccessorGameScene = vi.fn();
    }
    return { FakeGameScene };
});

vi.mock("../../../Connection/ConnectionManager", () => ({ connectionManager: { setCurrentRoom: vi.fn() } }));
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

import { FULL_SCREEN_AFTER_MS, softReconnect } from "../../../Connection/SoftReconnect";
import type { GameScene } from "../GameScene";
import { gameManager, GameSceneNotFoundError } from "../GameManager";

// While the room is kept on screen (#958), the chat stays open; between the old scene going away and the next one
// being created, what it reaches is the scene it already shows, never an error.
describe("the scene the chat reaches while the game gets back in", () => {
    const internals = gameManager as unknown as { scenePlugin: unknown };
    const picture = { src: "data:image/png;base64,AAAA", left: 0, top: 0, width: 428, height: 926 };
    const replaced = new mocks.FakeGameScene("room", { key: "old" }) as unknown as GameScene;

    afterEach(() => softReconnect.cancel());

    it("is the scene that lost its connection until the next one is created", () => {
        internals.scenePlugin = { get: () => undefined };
        softReconnect.start(picture, () => undefined);
        gameManager.keepReplacedGameScene(replaced);

        expect(gameManager.getCurrentGameScene()).toBe(replaced);
        // UI that checks whether a scene is there still sees none.
        expect(gameManager.tryGetCurrentGameScene()).toBeUndefined();

        const next = new mocks.FakeGameScene("room") as unknown as GameScene;
        internals.scenePlugin = { get: () => next };
        gameManager.gameSceneIsCreated(next);
        expect(gameManager.getCurrentGameScene()).toBe(next);

        // Dropped again before it is back in: the next scene goes too, and the chat still reaches the first one.
        internals.scenePlugin = { get: () => undefined };
        expect(gameManager.getCurrentGameScene()).toBe(replaced);
    });

    // The next scene is current as soon as it is created, but its chat exists only once the connection is back. #1051
    it("stays the scene that lost its connection until the next one has its chat", () => {
        internals.scenePlugin = { get: () => undefined };
        softReconnect.start(picture, () => undefined);
        gameManager.keepReplacedGameScene(replaced);

        const next = new mocks.FakeGameScene("room") as unknown as GameScene & { hasProximityChatRoom: boolean };
        next.hasProximityChatRoom = false;
        internals.scenePlugin = { get: () => next };
        gameManager.gameSceneIsCreated(next);

        expect(gameManager.getCurrentGameScene()).toBe(replaced);
        // UI that only checks whether a scene is there already sees the next one.
        expect(gameManager.tryGetCurrentGameScene()).toBe(next);

        next.hasProximityChatRoom = true;
        expect(gameManager.getCurrentGameScene()).toBe(next);
    });

    it("is not kept once the room is no longer on screen", () => {
        internals.scenePlugin = { get: () => undefined };
        softReconnect.start(picture, () => undefined);
        gameManager.keepReplacedGameScene(replaced);
        softReconnect.cancel();

        expect(() => gameManager.getCurrentGameScene()).toThrow(GameSceneNotFoundError);
    });

    // The room left while getting back in (a rename from Orbit, a Woka or camera page): that screen takes over, so the
    // picture, the pill and the 10 s wait of the full "Reconnecting" screen end. #1047
    it("ends the wait when the room is left", () => {
        const showFullScreen = vi.fn();
        vi.useFakeTimers();
        try {
            const scene = new mocks.FakeGameScene("room", { key: "old" });
            internals.scenePlugin = { get: () => scene };
            softReconnect.start(picture, showFullScreen);
            expect(softReconnect.isWaiting()).toBe(true);

            gameManager.closeGameScene();

            expect(softReconnect.isWaiting()).toBe(false);
            vi.advanceTimersByTime(FULL_SCREEN_AFTER_MS + 1_000);
            expect(showFullScreen).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });
});
