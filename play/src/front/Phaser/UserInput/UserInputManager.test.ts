import { describe, expect, it, vi } from "vitest";

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
