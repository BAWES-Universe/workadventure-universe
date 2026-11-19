import type { writable } from "svelte/store";
import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    addTemplateAction: vi.fn(),
    syncVisitingBrick: vi.fn(),
    notifyRoomEnter: vi.fn(),
    notifyRoomLeave: vi.fn(),
    isInitialized: vi.fn(),
    getCurrentGameScene: vi.fn(),
}));

vi.mock("../../Components/ActionsMenu/cardAnswers", () => ({
    CARD_ANSWER_KEPT_MS: 5000,
    CardAnswers: class {
        get() {
            return Promise.resolve({ allowed: true });
        }
    },
}));
vi.mock("../../Connection/LocalUserStore", () => ({
    localUserStore: { getLocalUser: () => undefined, isLogged: () => false },
}));
vi.mock("../../Stores/MenuStore", async () => {
    const { writable: store } = await import("svelte/store");
    return { mapEditorActivated: store(false), userIsConnected: store(false) };
});
vi.mock("../../Stores/MapEditorStore", async () => {
    const { writable: store } = await import("svelte/store");
    return {
        mapEditorModeStore: store(false),
        mapEditorVisibilityStore: store(false),
        mapEditorSelectedToolStore: store(undefined),
    };
});
vi.mock("../../Stores/EditModeStore", async () => {
    const { writable: store } = await import("svelte/store");
    return { editHintSeenStore: store(false), registerEditTool: vi.fn(() => () => undefined) };
});
vi.mock("../../../i18n/i18n-svelte", async () => {
    const { writable: store } = await import("svelte/store");
    return { default: store({}) };
});
vi.mock("../../Phaser/Game/MapEditor/MapEditorModeManager", () => ({ EditorToolName: {} }));
vi.mock("../../Phaser/Game/GameManager", () => ({
    gameManager: { getCurrentGameScene: mocks.getCurrentGameScene },
}));
vi.mock("../../Stores/ErrorStore", async () => {
    const { writable: store } = await import("svelte/store");
    return { warningMessageStore: { addWarningMessage: vi.fn(), ...store([]) } };
});
vi.mock("../../Notification/Push/PushDevice", () => ({ refreshThisDeviceOnce: vi.fn() }));
vi.mock("../../Chat/Bricks/BrickVisitStore", () => ({ provideOwnPosition: vi.fn() }));
vi.mock("../../Chat/Bricks/BrickHomeStore", () => ({ provideBrickLocator: vi.fn() }));
vi.mock("../../Chat/Bricks/Templates/TemplateCardAction", () => ({ addTemplateAction: mocks.addTemplateAction }));
vi.mock("./services/BotServerUrl", () => ({ getBotServerUrl: () => "https://bots.example.com" }));
vi.mock("./services/BotApiService", () => ({
    botApiService: {
        initialize: vi.fn(),
        getRoomId: () => "room-1",
        isInitialized: mocks.isInitialized,
        notifyRoomEnter: mocks.notifyRoomEnter,
        notifyRoomLeave: mocks.notifyRoomLeave,
        syncVisitingBrick: mocks.syncVisitingBrick,
        setOwnPlaceProvider: vi.fn(),
    },
}));
vi.mock("./services/summonFailure", () => ({ summonFailureLine: () => "" }));
vi.mock("./phaser/BotEditorTool", () => ({ destroyBotEditorTool: vi.fn() }));
vi.mock("@wa-icons", () => ({ IconMapPin: {}, IconRobot: {} }));

import { userIsConnected } from "../../Stores/MenuStore";
import { wokaMenuStore } from "../../Stores/WokaMenuStore";
import botExtensionModule, { registeredActionsByUuid, setupWokaMenuHook } from "./index";

describe("the card of a bot", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        wokaMenuStore.clear();
        registeredActionsByUuid.clear();
    });

    it("asks for the template button once for a card that opens, also when no Summon was registered for that bot yet", () => {
        setupWokaMenuHook();
        wokaMenuStore.initialize("Brick", 7, "bot-brick-1", undefined);
        expect(mocks.addTemplateAction).toHaveBeenCalledTimes(1);
        expect(mocks.addTemplateAction).toHaveBeenCalledWith("bot-brick-1", expect.any(Function));
        // The card holding its buttons back (the store speaks again with no actions) asks nothing a second time
        wokaMenuStore.expect("bot-brick-1", "something");
        expect(mocks.addTemplateAction).toHaveBeenCalledTimes(1);
    });

    it("still asks, and answers 'still open' only for the card that asked, when the card opens again", () => {
        setupWokaMenuHook();
        wokaMenuStore.initialize("Brick", 7, "bot-brick-1", undefined);
        const first = mocks.addTemplateAction.mock.calls[0][1] as () => boolean;
        expect(first()).toBe(true);
        wokaMenuStore.clear();
        expect(first()).toBe(false);
        wokaMenuStore.initialize("Brick", 7, "bot-brick-1", undefined);
        expect(mocks.addTemplateAction).toHaveBeenCalledTimes(2);
        const second = mocks.addTemplateAction.mock.calls[1][1] as () => boolean;
        expect(second()).toBe(true);
        expect(first()).toBe(false);
    });
});

describe("leaving a room", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        mocks.isInitialized.mockReturnValue(true);
        mocks.notifyRoomEnter.mockResolvedValue({ botsSpawned: 0 });
        mocks.notifyRoomLeave.mockResolvedValue(undefined);
        mocks.getCurrentGameScene.mockReturnValue(undefined);
        vi.spyOn(console, "log").mockImplementation(() => undefined);
        vi.spyOn(console, "error").mockImplementation(() => undefined);
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    const options = { roomId: "room-1", userAccessToken: null, adminUrl: "https://orbit.example.com" } as never;

    it("ends the wait for the sign-in, so the person who left sends no entry sync for the room they left", async () => {
        const connected = userIsConnected as unknown as ReturnType<typeof writable<boolean>>;
        connected.set(false);
        botExtensionModule.init?.({}, options);
        botExtensionModule.destroy?.();
        // The person is signed in, and the sprite shows, only after they left
        mocks.getCurrentGameScene.mockReturnValue({ CurrentPlayer: { x: 3, y: 4 } });
        connected.set(true);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(mocks.syncVisitingBrick).not.toHaveBeenCalled();
        expect(get(connected)).toBe(true);
    });

    it("ends the wait for the player's sprite, so no entry sync goes for the room that was left once the sprite shows", async () => {
        const connected = userIsConnected as unknown as ReturnType<typeof writable<boolean>>;
        connected.set(true);
        botExtensionModule.init?.({}, options);
        // The sprite is not there yet when the person leaves
        botExtensionModule.destroy?.();
        mocks.getCurrentGameScene.mockReturnValue({ CurrentPlayer: { x: 3, y: 4 } });
        await vi.advanceTimersByTimeAsync(60_000);
        expect(mocks.syncVisitingBrick).not.toHaveBeenCalled();
    });

    it("sends the entry sync when the person stays", async () => {
        const connected = userIsConnected as unknown as ReturnType<typeof writable<boolean>>;
        connected.set(true);
        botExtensionModule.init?.({}, options);
        mocks.getCurrentGameScene.mockReturnValue({ CurrentPlayer: { x: 3, y: 4 } });
        await vi.advanceTimersByTimeAsync(60_000);
        expect(mocks.syncVisitingBrick).toHaveBeenCalledWith({ x: 3, y: 4 }, { entry: true });
        botExtensionModule.destroy?.();
    });
});
