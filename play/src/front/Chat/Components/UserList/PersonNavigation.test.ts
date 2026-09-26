import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

const returnToPlayer = vi.fn();
const emitAskPosition = vi.fn();
let scene: unknown;

vi.mock("../../../Phaser/Game/GameManager", () => ({
    gameManager: { tryGetCurrentGameScene: () => scene },
}));
vi.mock("../../../Api/ScriptUtils", () => ({ scriptUtils: { goToPage: vi.fn() } }));
vi.mock("../../../Enum/EnvironmentVariable", () => ({ WOKA_SPEED: 9 }));

describe("showMyself", () => {
    beforeEach(() => {
        returnToPlayer.mockClear();
        emitAskPosition.mockClear();
        scene = { getCameraManager: () => ({ returnToPlayer }), connection: { emitAskPosition } };
    });

    it("closes the open card and brings the camera back, without searching for anyone", async () => {
        const { wokaMenuStore } = await import("../../../Stores/WokaMenuStore");
        const { showMyself } = await import("./PersonNavigation");
        wokaMenuStore.initialize("Imagine [Music]", 7, "bot-imagine", undefined);

        showMyself();

        expect(get(wokaMenuStore)).toBeUndefined();
        expect(returnToPlayer).toHaveBeenCalledTimes(1);
        expect(emitAskPosition).not.toHaveBeenCalled();
    });

    it("does nothing while no map is loaded (a reconnect)", async () => {
        const { showMyself } = await import("./PersonNavigation");
        scene = undefined;

        showMyself();

        expect(returnToPlayer).not.toHaveBeenCalled();
    });
});
