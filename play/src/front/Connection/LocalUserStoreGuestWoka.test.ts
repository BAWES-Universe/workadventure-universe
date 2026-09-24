import { beforeEach, describe, expect, it, vi } from "vitest";
import { localUserStore } from "./LocalUserStore";

vi.mock("../Enum/EnvironmentVariable.ts", () => {
    return {
        PEER_SCREEN_SHARE_RECOMMENDED_BANDWIDTH: 0,
        PEER_VIDEO_RECOMMENDED_BANDWIDTH: 0,
        MAX_USERNAME_LENGTH: 10,
    };
});

describe("LocalUserStore guest woka backup", () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it("restores the guest woka after login cleared it", () => {
        localUserStore.setCharacterTextures(["male1"]);
        localUserStore.backupGuestCharacterTextures();
        localUserStore.setCharacterTextures([]);

        expect(localUserStore.restoreGuestCharacterTextures()).toBe(true);
        expect(localUserStore.getCharacterTextures()).toEqual(["male1"]);
    });

    it("keeps a woka saved during the logged-in session", () => {
        localUserStore.setCharacterTextures(["male1"]);
        localUserStore.backupGuestCharacterTextures();
        localUserStore.setCharacterTextures(["female3"]);

        expect(localUserStore.restoreGuestCharacterTextures()).toBe(false);
        expect(localUserStore.getCharacterTextures()).toEqual(["female3"]);
    });

    it("does nothing for a visitor who never picked a woka", () => {
        localUserStore.backupGuestCharacterTextures();
        localUserStore.setCharacterTextures([]);

        expect(localUserStore.restoreGuestCharacterTextures()).toBe(false);
        expect(localUserStore.getCharacterTextures()).toBeNull();
    });

    it("does not overwrite the guest backup when login starts with no woka", () => {
        localUserStore.setCharacterTextures(["male1"]);
        localUserStore.backupGuestCharacterTextures();
        localUserStore.setCharacterTextures([]);
        // A second login attempt while the woka is already cleared
        localUserStore.backupGuestCharacterTextures();

        expect(localUserStore.restoreGuestCharacterTextures()).toBe(true);
        expect(localUserStore.getCharacterTextures()).toEqual(["male1"]);
    });

    it("ignores a corrupted backup", () => {
        localStorage.setItem("guestCharacterTextures", "{not json");
        localUserStore.setCharacterTextures([]);

        expect(localUserStore.restoreGuestCharacterTextures()).toBe(false);
        expect(localUserStore.getCharacterTextures()).toBeNull();
    });
});
