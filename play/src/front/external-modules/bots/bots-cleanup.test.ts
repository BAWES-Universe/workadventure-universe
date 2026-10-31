import { writable } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionModuleOptions } from "../../ExternalModule/ExtensionModule";
import type { WokaMenuAction, WokaMenuData } from "../../Stores/WokaMenuStore";

const mocks = vi.hoisted(() => {
    let menuValue: WokaMenuData | undefined = undefined;
    const subscribers = new Set<(val: WokaMenuData | undefined) => void>();
    const setMenu = (val: WokaMenuData | undefined) => {
        menuValue = val;
        subscribers.forEach((fn) => fn(menuValue));
    };
    const wokaMenuStoreMock = {
        subscribe: (fn: (val: WokaMenuData | undefined) => void) => {
            fn(menuValue);
            subscribers.add(fn);
            return () => subscribers.delete(fn);
        },
        set: setMenu,
        update: (updater: (val: WokaMenuData | undefined) => WokaMenuData | undefined) => {
            setMenu(updater(menuValue));
        },
        addAction: vi.fn((action: WokaMenuAction) => {
            if (!menuValue) return;
            setMenu({ ...menuValue, actions: [...menuValue.actions, action] });
        }),
    };
    return {
        getCurrentGameScene: vi.fn(),
        isLogged: vi.fn(() => false),
        getAuthToken: vi.fn(() => null),
        getLocalUser: vi.fn(() => ({ uuid: "player-1" })),
        notifyRoomEnter: vi.fn(() => Promise.resolve({ botsSpawned: 0 })),
        notifyRoomLeave: vi.fn(() => Promise.resolve()),
        initializeApi: vi.fn(),
        isInitialized: vi.fn(() => false),
        getRoomId: vi.fn(() => null),
        destroyBotEditorTool: vi.fn(),
        wokaMenuStoreMock,
    };
});

vi.mock("../../Connection/LocalUserStore", () => ({
    localUserStore: {
        isLogged: mocks.isLogged,
        getAuthToken: mocks.getAuthToken,
        getLocalUser: mocks.getLocalUser,
    },
}));

vi.mock("../../Stores/MenuStore", () => ({
    mapEditorActivated: writable(false),
    userIsConnected: writable(false),
}));

vi.mock("../../Stores/MapEditorStore", () => ({
    mapEditorModeStore: {
        ...writable(false),
        switchMode: vi.fn(),
    },
    mapEditorVisibilityStore: writable(false),
    mapEditorSelectedToolStore: writable("EntityEditor"),
}));

vi.mock("../../Stores/EditModeStore", () => ({
    editHintSeenStore: writable(false),
    registerEditTool: vi.fn(() => vi.fn()),
}));

vi.mock("../../../i18n/i18n-svelte", () => ({
    default: writable({}),
}));

vi.mock("../../Phaser/Game/MapEditor/MapEditorModeManager", () => ({
    EditorToolName: {
        EntityEditor: "EntityEditor",
    },
}));

vi.mock("../../Phaser/Game/GameManager", () => ({
    gameManager: {
        getCurrentGameScene: mocks.getCurrentGameScene,
    },
}));

vi.mock("../../Stores/WokaMenuStore", () => ({
    wokaMenuStore: mocks.wokaMenuStoreMock,
}));

vi.mock("../../Enum/EnvironmentVariable", () => ({
    BOT_SERVER_URL: undefined,
}));

vi.mock("./services/BotApiService", () => ({
    botApiService: {
        initialize: mocks.initializeApi,
        notifyRoomEnter: mocks.notifyRoomEnter,
        notifyRoomLeave: mocks.notifyRoomLeave,
        isInitialized: mocks.isInitialized,
        getRoomId: mocks.getRoomId,
        summonBot: vi.fn(() => Promise.resolve()),
    },
}));

vi.mock("./phaser/BotEditorTool", () => ({
    destroyBotEditorTool: mocks.destroyBotEditorTool,
}));

vi.mock("@wa-icons", () => ({
    IconMapPin: "IconMapPin",
    IconRobot: "IconRobot",
}));

import botExtensionModule from "./index";

function makeOptions(roomId: string): ExtensionModuleOptions {
    return {
        roomId,
    } as unknown as ExtensionModuleOptions;
}

function makeBotScene(botUuid = "bot-alpha") {
    const players = new Map([[1, { userUuid: botUuid, name: "Alpha" }]]);
    const mapPlayersByKey = new Map([[1, {}]]);
    return {
        getRemotePlayersRepository: () => ({
            getPlayers: () => players,
        }),
        MapPlayersByKey: mapPlayersByKey,
        CurrentPlayer: { x: 10, y: 20 },
    };
}

describe("bots module summon-button timer cleanup (#1037)", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal("window", {
            location: { protocol: "http:", hostname: "localhost", port: "8080" },
        });
        vi.stubGlobal("document", {
            querySelector: () => null,
            getElementById: () => null,
        });
        vi.clearAllMocks();
        mocks.wokaMenuStoreMock.set(undefined);
        mocks.getCurrentGameScene.mockReturnValue(makeBotScene("bot-alpha"));
    });

    afterEach(() => {
        botExtensionModule.destroy?.();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it("stops the 10 s summon-button refresh when leaving a room", () => {
        botExtensionModule.init(undefined, makeOptions("room-1"));

        // 2 s initial delay + five 3 s retries (17 s total) transitions into the 10 s refresh interval
        vi.advanceTimersByTime(17_000);
        mocks.getCurrentGameScene.mockClear();

        vi.advanceTimersByTime(20_000);
        expect(mocks.getCurrentGameScene).toHaveBeenCalledTimes(2);

        botExtensionModule.destroy?.();
        mocks.getCurrentGameScene.mockClear();

        vi.advanceTimersByTime(60_000);
        expect(mocks.getCurrentGameScene).toHaveBeenCalledTimes(0);
    });

    it("stops the 3 s summon-button retry when leaving a room before retries finish", () => {
        botExtensionModule.init(undefined, makeOptions("room-1"));

        // Advance 5 s: past the 2 s delay and 1st 3 s retry, with 4 retries remaining
        vi.advanceTimersByTime(5_000);
        expect(mocks.getCurrentGameScene).toHaveBeenCalled();

        botExtensionModule.destroy?.();
        mocks.getCurrentGameScene.mockClear();

        // Neither the remaining 3 s retries nor the 10 s refresh should fire after destroy()
        vi.advanceTimersByTime(60_000);
        expect(mocks.getCurrentGameScene).toHaveBeenCalledTimes(0);
    });

    it("registers summon buttons in a new room without stacking refresh intervals across room changes", async () => {
        botExtensionModule.init(undefined, makeOptions("room-1"));
        vi.advanceTimersByTime(27_000);
        botExtensionModule.destroy?.();

        mocks.getCurrentGameScene.mockReturnValue(makeBotScene("bot-room-2"));
        botExtensionModule.init(undefined, makeOptions("room-2"));

        // Advance past the 2 s delay + five 3 s retries into the 10 s refresh window
        vi.advanceTimersByTime(17_000);
        mocks.getCurrentGameScene.mockClear();

        // Over 30 s, only room-2's single 10 s refresh should fire (3 times, not 6)
        vi.advanceTimersByTime(30_000);
        expect(mocks.getCurrentGameScene).toHaveBeenCalledTimes(3);

        // Opening the Woka menu for the new room's bot attaches the Summon action
        mocks.wokaMenuStoreMock.set({
            wokaName: "Bot Two",
            userUuid: "bot-room-2",
            actions: [],
        });
        await Promise.resolve();
        expect(mocks.wokaMenuStoreMock.addAction).toHaveBeenCalledWith(
            expect.objectContaining({ actionName: "Summon" })
        );
    });

    it("stops the 2 s startup, 3 s init, and room-enter timeouts when leaving before 2 s", async () => {
        let resolveLateEnter!: (val: { botsSpawned: number }) => void;
        mocks.notifyRoomEnter.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    resolveLateEnter = resolve;
                })
        );

        botExtensionModule.init(undefined, makeOptions("room-early"));
        vi.advanceTimersByTime(1_000);

        botExtensionModule.destroy?.();
        // Resolve notifyRoomEnter after destroy() to verify lifecycle guard blocks late timeout
        resolveLateEnter({ botsSpawned: 1 });
        await Promise.resolve();
        mocks.getCurrentGameScene.mockClear();

        vi.advanceTimersByTime(60_000);
        expect(mocks.getCurrentGameScene).toHaveBeenCalledTimes(0);
    });

    it("stops the 3 s fallback retry timeout when scene or localUser is unavailable before leaving", async () => {
        mocks.getCurrentGameScene.mockReturnValue(undefined);
        botExtensionModule.init(undefined, makeOptions("room-no-scene"));
        await Promise.resolve();

        // Trigger the 2 s startup call while scene is undefined (schedules 3 s fallback timeout)
        vi.advanceTimersByTime(2_000);
        expect(mocks.getCurrentGameScene).toHaveBeenCalledTimes(1);

        // Also test localUser unavailable fallback before destroy
        mocks.getCurrentGameScene.mockReturnValue(makeBotScene("bot-alpha"));
        mocks.getLocalUser.mockReturnValueOnce(null as unknown as { uuid: string });
        vi.advanceTimersByTime(1_000);

        botExtensionModule.destroy?.();
        mocks.getCurrentGameScene.mockClear();

        vi.advanceTimersByTime(60_000);
        expect(mocks.getCurrentGameScene).toHaveBeenCalledTimes(0);
    });
});
