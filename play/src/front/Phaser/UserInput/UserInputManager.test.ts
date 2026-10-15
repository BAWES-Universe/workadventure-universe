import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../Touch/TouchScreenManager", () => ({ touchScreenManager: { supportTouchScreen: false } }));
vi.mock("../Components/MobileJoystick", () => ({ MobileJoystick: class {} }));
vi.mock("../../Stores/UserInputStore", async () => {
    const { writable } = await import("svelte/store");
    return { enableUserInputsStore: writable(true) };
});
vi.mock("../../Stores/MapEditorStore", async () => {
    const { writable } = await import("svelte/store");
    return { mapEditorModeStore: writable(false) };
});
vi.mock("../../../i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    return { default: readable({}) };
});

import { ActiveEventList, UserInputEvent, UserInputManager } from "./UserInputManager";

/** A manager without its scene wiring, with the up arrow held: only what taking and giving back the controls touches. */
function manager() {
    const upArrow = { isDown: true, originalEvent: { target: null }, reset: vi.fn() };
    // Like Phaser's, letting go of every key marks them released.
    const keyboard = {
        disableGlobalCapture: vi.fn(),
        enableGlobalCapture: vi.fn(),
        resetKeys: vi.fn(() => {
            upArrow.isDown = false;
        }),
    };
    const inputManager = Object.create(UserInputManager.prototype) as UserInputManager;
    Object.assign(inputManager, {
        scene: { input: { keyboard } },
        disableControlsReasons: new Set(),
        isInputDisabled: false,
        keysCode: [{ event: UserInputEvent.MoveUp, keyInstance: upArrow }],
        joystickEvents: new ActiveEventList(),
    });
    return { inputManager, keyboard };
}

describe("UserInputManager", () => {
    it("lets go of held keys when something takes the keyboard, so the player does not walk on afterwards", () => {
        const { inputManager, keyboard } = manager();
        expect(inputManager.getEventListForGameTick().get(UserInputEvent.MoveUp)).toBe(true);

        // A text box takes the keyboard while the arrow is held (and swallows the key's release).
        inputManager.disableControls("store");
        expect(keyboard.resetKeys).toHaveBeenCalledTimes(1);
        expect(inputManager.isControlsEnabled).toBe(false);

        inputManager.restoreControls("store");
        expect(inputManager.isControlsEnabled).toBe(true);
        expect(inputManager.getEventListForGameTick().get(UserInputEvent.MoveUp)).toBe(false);
        expect(inputManager.getEventListForGameTick().any()).toBe(false);
    });
});

/** Bind the real scene callbacks without booting Phaser's renderer or keyboard. */
function wiredManager() {
    const { inputManager } = manager();
    type PointerHandler = (pointer: Phaser.Input.Pointer, objects: Phaser.GameObjects.GameObject[]) => void;
    const handlers = new Map<string, PointerHandler>();
    vi.stubGlobal("Phaser", {
        Input: {
            Events: {
                POINTER_DOWN: "pointerdown",
                POINTER_UP: "pointerup",
                POINTER_MOVE: "pointermove",
                POINTER_WHEEL: "wheel",
            },
        },
    });
    const joystick = { showAt: vi.fn(), hide: vi.fn() };
    const userInputHandler = {
        handlePointerDownEvent: vi.fn(),
        handlePointerUpEvent: vi.fn(),
        handlePointerMoveEvent: vi.fn(),
    };
    Object.assign(inputManager, {
        scene: { input: { on: (name: string, handler: PointerHandler) => handlers.set(name, handler) } },
        joystick,
        userInputHandler,
    });
    (inputManager as unknown as { bindInputEventHandlers(): void }).bindInputEventHandlers();
    const dispatch = (name: string, pointer: Phaser.Input.Pointer) => handlers.get(name)?.(pointer, []);
    const touch = (count = 1) =>
        ({
            x: 100,
            y: 100,
            wasTouch: true,
            event: new TouchEvent("touchstart", {
                touches: Array.from({ length: count }, () => ({ clientX: 100, clientY: 100 } as Touch)),
            }),
        } as Phaser.Input.Pointer);
    return { inputManager, joystick, userInputHandler, dispatch, touch };
}

describe("joystick input routing", () => {
    afterEach(() => vi.unstubAllGlobals());
    it("passes the accepted single touch to the joystick for immediate capture", () => {
        const { joystick, dispatch, touch } = wiredManager();
        const pointer = touch();
        dispatch("pointerdown", pointer);
        expect(joystick.showAt).toHaveBeenCalledWith(100, 100, pointer);
    });

    it("keeps mouse click handlers without starting a touch joystick", () => {
        const { joystick, userInputHandler, dispatch } = wiredManager();
        const pointer = { wasTouch: false, event: new MouseEvent("mousedown") } as Phaser.Input.Pointer;
        dispatch("pointerdown", pointer);
        dispatch("pointerup", pointer);
        expect(userInputHandler.handlePointerDownEvent).toHaveBeenCalledWith(pointer, []);
        expect(userInputHandler.handlePointerUpEvent).toHaveBeenCalledWith(pointer, []);
        expect(joystick.showAt).not.toHaveBeenCalled();
    });

    it("does not start the joystick for multitouch or disabled controls", () => {
        const { inputManager, joystick, dispatch, touch } = wiredManager();
        dispatch("pointerdown", touch(2));
        expect(joystick.hide).toHaveBeenCalledWith(30_000);
        Object.assign(inputManager, { isInputDisabled: true });
        dispatch("pointerdown", touch());
        expect(joystick.showAt).not.toHaveBeenCalled();
    });

    it("keeps editor gestures out of the joystick", async () => {
        const { mapEditorModeStore } = await import("../../Stores/MapEditorStore");
        const { joystick, dispatch, touch } = wiredManager();
        mapEditorModeStore.set(true);
        try {
            dispatch("pointerdown", touch());
            expect(joystick.showAt).not.toHaveBeenCalled();
        } finally {
            mapEditorModeStore.set(false);
        }
    });
});
