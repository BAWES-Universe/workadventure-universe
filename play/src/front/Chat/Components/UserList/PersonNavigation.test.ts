import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

const returnToPlayer = vi.fn();
const emitAskPosition = vi.fn();
let scene: unknown;

const canOpenOrbit = vi.fn(() => true);
const openOrbitPage = vi.fn();

vi.mock("../../../Phaser/Game/GameManager", () => ({
    gameManager: {
        tryGetCurrentGameScene: () => scene,
        getPlayerName: () => "Khalid",
        myVisitCardUrl: "https://orbit.example/api/profile/me-uuid?embed=true",
    },
}));
vi.mock("../../../external-modules/admin-api/index", () => ({ canOpenOrbit, openOrbitPage }));
vi.mock("../../../Api/ScriptUtils", () => ({ scriptUtils: { goToPage: vi.fn() } }));
vi.mock("../../../Enum/EnvironmentVariable", () => ({ WOKA_SPEED: 9 }));

describe("showMyself", () => {
    beforeEach(async () => {
        returnToPlayer.mockClear();
        emitAskPosition.mockClear();
        openOrbitPage.mockClear();
        canOpenOrbit.mockReturnValue(true);
        scene = {
            getCameraManager: () => ({ returnToPlayer }),
            connection: { emitAskPosition, getUserId: () => 42 },
        };
        const { wokaMenuStore } = await import("../../../Stores/WokaMenuStore");
        wokaMenuStore.clear();
    });

    it("opens your own card with your visit card, and brings the camera back without searching", async () => {
        const { wokaMenuStore } = await import("../../../Stores/WokaMenuStore");
        const { showMyself } = await import("./PersonNavigation");
        wokaMenuStore.initialize("Imagine [Music]", 7, "bot-imagine", undefined);

        showMyself("me-uuid");

        const card = get(wokaMenuStore);
        expect(card).toMatchObject({
            wokaName: "Khalid",
            userId: 42,
            userUuid: "me-uuid",
            visitCardUrl: "https://orbit.example/api/profile/me-uuid?embed=true",
            isSelf: true,
        });
        expect(returnToPlayer).toHaveBeenCalledTimes(1);
        expect(emitAskPosition).not.toHaveBeenCalled();
    });

    it("has one action, which opens Orbit on the visit card page", async () => {
        const { wokaMenuStore } = await import("../../../Stores/WokaMenuStore");
        const { showMyself, EDIT_VISIT_CARD_PAGE } = await import("./PersonNavigation");

        showMyself("me-uuid");

        const actions = get(wokaMenuStore)?.actions ?? [];
        expect(actions.map((action) => action.testId)).toEqual(["edit-my-visit-card"]);
        actions[0].callback();
        expect(openOrbitPage).toHaveBeenCalledWith(EDIT_VISIT_CARD_PAGE);
        expect(EDIT_VISIT_CARD_PAGE).toBe("/admin/profile");
        expect(get(wokaMenuStore)).toBeUndefined();
    });

    it("shows your card without the edit button when you can't use Orbit (a guest)", async () => {
        const { wokaMenuStore } = await import("../../../Stores/WokaMenuStore");
        const { showMyself } = await import("./PersonNavigation");
        canOpenOrbit.mockReturnValue(false);

        showMyself("me-uuid");

        expect(get(wokaMenuStore)?.isSelf).toBe(true);
        expect(get(wokaMenuStore)?.actions).toEqual([]);
    });

    it("without an account id, closes the open card and brings the camera back", async () => {
        const { wokaMenuStore } = await import("../../../Stores/WokaMenuStore");
        const { showMyself } = await import("./PersonNavigation");
        wokaMenuStore.initialize("Imagine [Music]", 7, "bot-imagine", undefined);

        showMyself(undefined);

        expect(get(wokaMenuStore)).toBeUndefined();
        expect(returnToPlayer).toHaveBeenCalledTimes(1);
    });

    it("does nothing while no map is loaded (a reconnect)", async () => {
        const { wokaMenuStore } = await import("../../../Stores/WokaMenuStore");
        const { showMyself } = await import("./PersonNavigation");
        scene = undefined;

        showMyself("me-uuid");

        expect(returnToPlayer).not.toHaveBeenCalled();
        expect(get(wokaMenuStore)).toBeUndefined();
    });
});
