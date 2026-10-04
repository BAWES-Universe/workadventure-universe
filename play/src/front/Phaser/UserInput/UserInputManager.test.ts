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

import { UserInputManager } from "./UserInputManager";

/** A manager without its scene wiring: only what taking and giving back the controls touches. */
function manager() {
    const keyboard = { disableGlobalCapture: vi.fn(), enableGlobalCapture: vi.fn(), resetKeys: vi.fn() };
    const inputManager = Object.create(UserInputManager.prototype) as UserInputManager;
    Object.assign(inputManager, {
        scene: { input: { keyboard } },
        disableControlsReasons: new Set(),
        isInputDisabled: false,
        keysCode: [],
    });
    return { inputManager, keyboard };
}

describe("UserInputManager", () => {
    it("lets go of held keys when something takes the keyboard, so the player does not walk on afterwards", () => {
        const { inputManager, keyboard } = manager();

        // A movement key is held, then a text box takes the keyboard (and swallows the key's release).
        inputManager.disableControls("store");
        expect(keyboard.resetKeys).toHaveBeenCalledTimes(1);
        expect(inputManager.isControlsEnabled).toBe(false);

        inputManager.restoreControls("store");
        expect(inputManager.isControlsEnabled).toBe(true);
        expect(inputManager.getEventListForGameTick().any()).toBe(false);
    });
});
