import { describe, expect, it, vi } from "vitest";
import { shouldSaveNameOnServer, stepAfterName } from "./LocalUserUtils";

vi.mock("../Enum/EnvironmentVariable.ts", () => {
    return {
        MAX_USERNAME_LENGTH: 10,
    };
});

describe("shouldSaveNameOnServer", () => {
    it("keeps a signed-in player's name on their account", () => {
        expect(shouldSaveNameOnServer({ hasNameCapability: true, hasAuthToken: true, isSignedIn: true })).toBe(true);
    });

    it("keeps a guest's name on the device: the server saves nothing for a guest", () => {
        expect(shouldSaveNameOnServer({ hasNameCapability: true, hasAuthToken: true, isSignedIn: false })).toBe(false);
    });

    it("does not send the name without the admin capability or a token", () => {
        expect(shouldSaveNameOnServer({ hasNameCapability: false, hasAuthToken: true, isSignedIn: true })).toBe(false);
        expect(shouldSaveNameOnServer({ hasNameCapability: true, hasAuthToken: false, isSignedIn: true })).toBe(false);
    });
});

describe("stepAfterName", () => {
    it("opens the Woka picker for a first visit with no Woka", () => {
        expect(stepAfterName({ characterTextureIds: null, loadNextScene: "selectCharacterScene" })).toBe("wokaPicker");
        expect(stepAfterName({ characterTextureIds: [], loadNextScene: "gameScene" })).toBe("wokaPicker");
    });

    it("skips the Woka picker when a valid Woka is already stored", () => {
        expect(stepAfterName({ characterTextureIds: ["male1"], loadNextScene: "gameScene" })).toBe("camera");
    });

    it("still opens the picker when the page load said the stored Woka is refused", () => {
        expect(stepAfterName({ characterTextureIds: ["male1"], loadNextScene: "selectCharacterScene" })).toBe(
            "wokaPicker"
        );
    });

    it("opens the Woka picker when the stored Woka is not usable", () => {
        expect(stepAfterName({ characterTextureIds: [" "], loadNextScene: "gameScene" })).toBe("wokaPicker");
    });

    it("goes to the companion step when the load asked for it and the Woka is fine", () => {
        expect(stepAfterName({ characterTextureIds: ["male1"], loadNextScene: "selectCompanionScene" })).toBe(
            "companionPicker"
        );
    });
});
