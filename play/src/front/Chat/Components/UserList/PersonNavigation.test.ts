import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

const returnToPlayer = vi.fn();
const emitAskPosition = vi.fn();
let scene: unknown;

const canOpenOrbit = vi.fn(() => true);
const openOrbitPage = vi.fn();
const openOrbitProfile = vi.fn();
const openDirectChatRoom = vi.fn(() => Promise.resolve());
const goToPage = vi.fn();

vi.mock("../../../Phaser/Game/GameManager", () => ({
    gameManager: {
        tryGetCurrentGameScene: () => scene,
        getPlayerName: () => "Khalid",
        myVisitCardUrl: "https://orbit.example/api/profile/me-uuid?embed=true",
    },
}));
vi.mock("../../../external-modules/admin-api/index", () => ({ canOpenOrbit, openOrbitPage, openOrbitProfile }));
vi.mock("../../../Api/ScriptUtils", () => ({ scriptUtils: { goToPage } }));
vi.mock("../../Utils", () => ({ openDirectChatRoom }));
vi.mock("../../../WebRtc/BlackListManager", () => ({ blackListManager: { isBlackListed: () => false } }));
vi.mock("../../../Stores/ShowReportScreenStore", () => ({ showReportScreenStore: { set: vi.fn() } }));
vi.mock("../../Stores/PeopleCardReturnStore", () => ({ peopleCardReturn: { tappedPerson: vi.fn() } }));
vi.mock("../../../Administration/AnalyticsClient", () => ({
    analyticsClient: { openWokaMenu: vi.fn(), goToUser: vi.fn(), openedChat: vi.fn(), reportUser: vi.fn() },
}));
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

    it("has View profile then Edit my profile, side by side", async () => {
        const { wokaMenuStore } = await import("../../../Stores/WokaMenuStore");
        const { showMyself } = await import("./PersonNavigation");
        openOrbitProfile.mockClear();

        showMyself("me-uuid");

        const actions = get(wokaMenuStore)?.actions ?? [];
        expect(actions.map((action) => action.testId)).toEqual(["view-my-profile", "edit-my-visit-card"]);
        expect(actions.some((action) => action.overflow)).toBe(false);
        // View profile sorts first (the card shows the highest priority first).
        expect(actions[0].priority).toBeGreaterThan(actions[1].priority ?? 0);
        actions[0].callback();
        expect(openOrbitProfile).toHaveBeenCalledWith("me-uuid");
        expect(get(wokaMenuStore)).toBeUndefined();
    });

    it("opens Orbit on the profile editor from Edit my profile", async () => {
        const { wokaMenuStore } = await import("../../../Stores/WokaMenuStore");
        const { showMyself, EDIT_VISIT_CARD_PAGE } = await import("./PersonNavigation");

        showMyself("me-uuid");

        const actions = get(wokaMenuStore)?.actions ?? [];
        actions.find((action) => action.testId === "edit-my-visit-card")?.callback();
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

describe("toggleMyCard", () => {
    beforeEach(async () => {
        returnToPlayer.mockClear();
        canOpenOrbit.mockReturnValue(true);
        scene = {
            getCameraManager: () => ({ returnToPlayer }),
            connection: { emitAskPosition, getUserId: () => 42 },
        };
        const { wokaMenuStore } = await import("../../../Stores/WokaMenuStore");
        wokaMenuStore.clear();
    });

    it("opens your card on the first tap of your avatar and closes it on the next", async () => {
        const { wokaMenuStore } = await import("../../../Stores/WokaMenuStore");
        const { toggleMyCard } = await import("./PersonNavigation");

        toggleMyCard("me-uuid");
        expect(get(wokaMenuStore)).toMatchObject({ isSelf: true, userUuid: "me-uuid" });
        expect(get(wokaMenuStore)?.actions.map((action) => action.testId)).toEqual([
            "view-my-profile",
            "edit-my-visit-card",
        ]);

        toggleMyCard("me-uuid");
        expect(get(wokaMenuStore)).toBeUndefined();
    });

    it("replaces someone else's open card with yours", async () => {
        const { wokaMenuStore } = await import("../../../Stores/WokaMenuStore");
        const { toggleMyCard } = await import("./PersonNavigation");
        wokaMenuStore.initialize("Imagine", 7, "imagine-uuid", undefined);

        toggleMyCard("me-uuid");

        expect(get(wokaMenuStore)).toMatchObject({ isSelf: true, userUuid: "me-uuid", wokaName: "Khalid" });
    });
});

describe("showPersonCard", () => {
    const ELSEWHERE = "http://play.test/_/global/maps/elsewhere.json";
    const ada = {
        uuid: "ada-uuid",
        playUri: ELSEWHERE,
        chatId: "@ada:matrix.test",
        visitCardUrl: "https://orbit.example/api/profile/ada-uuid?embed=true",
    };

    beforeEach(async () => {
        canOpenOrbit.mockReturnValue(true);
        openOrbitProfile.mockClear();
        openDirectChatRoom.mockClear();
        goToPage.mockClear();
        scene = { getCameraManager: () => ({ returnToPlayer }), connection: { emitAskPosition, getUserId: () => 42 } };
        const { wokaMenuStore } = await import("../../../Stores/WokaMenuStore");
        wokaMenuStore.clear();
    });

    it("opens their card with their profile, and no avatar to follow", async () => {
        const { wokaMenuStore } = await import("../../../Stores/WokaMenuStore");
        const { showPersonCard } = await import("./PersonNavigation");

        showPersonCard(ada, "Ada", true);

        expect(get(wokaMenuStore)).toMatchObject({
            wokaName: "Ada",
            userId: -1,
            userUuid: "ada-uuid",
            visitCardUrl: ada.visitCardUrl,
            isSelf: false,
        });
        expect(emitAskPosition).not.toHaveBeenCalled();
    });

    it("offers Go to room, Message and View profile, with Block or report under more", async () => {
        const { wokaMenuStore } = await import("../../../Stores/WokaMenuStore");
        const { showPersonCard } = await import("./PersonNavigation");

        showPersonCard(ada, "Ada", true);

        const actions = get(wokaMenuStore)?.actions ?? [];
        expect(actions.filter((a) => !a.overflow).map((a) => a.testId)).toEqual([
            "wokamenu-go-to-room-button",
            "wokamenu-message-button",
            "wokamenu-view-profile-button",
        ]);
        expect(actions.filter((a) => a.overflow).map((a) => a.testId)).toEqual(["wokamenu-block-user-button"]);

        actions.find((a) => a.testId === "wokamenu-view-profile-button")?.callback();
        expect(openOrbitProfile).toHaveBeenCalledWith("ada-uuid");
    });

    it("leaves out Message when you can't message them, and View profile when you can't open Orbit", async () => {
        const { wokaMenuStore } = await import("../../../Stores/WokaMenuStore");
        const { showPersonCard } = await import("./PersonNavigation");
        canOpenOrbit.mockReturnValue(false);

        showPersonCard(ada, "Ada", false);

        const ids = (get(wokaMenuStore)?.actions ?? []).map((a) => a.testId);
        expect(ids).not.toContain("wokamenu-message-button");
        expect(ids).not.toContain("wokamenu-view-profile-button");
        expect(ids).toContain("wokamenu-go-to-room-button");
    });

    it("gives a guest (no chat id) no Message or View profile", async () => {
        const { wokaMenuStore } = await import("../../../Stores/WokaMenuStore");
        const { showPersonCard } = await import("./PersonNavigation");

        showPersonCard({ ...ada, chatId: undefined }, "Ada", true);

        const ids = (get(wokaMenuStore)?.actions ?? []).map((a) => a.testId);
        expect(ids).toEqual(["wokamenu-go-to-room-button", "wokamenu-block-user-button"]);
    });
});
