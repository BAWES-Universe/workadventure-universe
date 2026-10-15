import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localUserStore } from "./LocalUserStore";

vi.mock("../Enum/EnvironmentVariable.ts", () => {
    return {
        PEER_SCREEN_SHARE_RECOMMENDED_BANDWIDTH: 0,
        PEER_VIDEO_RECOMMENDED_BANDWIDTH: 0,
        MAX_USERNAME_LENGTH: 10,
    };
});

describe("LocalUserStore install flags", () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("remembers the card record, the install counted, and forgets them", () => {
        expect(localUserStore.readInstallCard()).toBeUndefined();
        const record = { lastShownAt: 1234, closeStreak: 2, lastClosed: true };
        localUserStore.writeInstallCard(record);
        expect(localUserStore.readInstallCard()).toEqual(record);
        expect(JSON.parse(localStorage.getItem("installCard") ?? "null")).toEqual(record);
        localUserStore.clearInstallCard();
        expect(localUserStore.readInstallCard()).toBeUndefined();

        localUserStore.markInstallReported();
        expect(localUserStore.isInstallReported()).toBe(true);
        localUserStore.clearInstallReported();
        expect(localUserStore.isInstallReported()).toBe(false);
    });

    it("moves the old once-ever flag to a record that counts as shown now", () => {
        vi.spyOn(Date, "now").mockReturnValue(5000);
        localStorage.setItem("installCardSeen", "true");
        const record = { lastShownAt: 5000, closeStreak: 0, lastClosed: false };
        expect(localUserStore.readInstallCard()).toEqual(record);
        expect(localStorage.getItem("installCardSeen")).toBeNull();
        expect(JSON.parse(localStorage.getItem("installCard") ?? "null")).toEqual(record);
        // Read again later: the same record, not a new "now".
        vi.spyOn(Date, "now").mockReturnValue(9000);
        expect(localUserStore.readInstallCard()).toEqual(record);
    });

    it("keeps its own record over the old flag", () => {
        const record = { lastShownAt: 1, closeStreak: 1, lastClosed: true };
        localStorage.setItem("installCard", JSON.stringify(record));
        localStorage.setItem("installCardSeen", "true");
        expect(localUserStore.readInstallCard()).toEqual(record);
    });

    it("treats a malformed record as none", () => {
        for (const raw of [
            "not json",
            "null",
            "[]",
            "{}",
            JSON.stringify({ lastShownAt: "yesterday", closeStreak: 0, lastClosed: false }),
            JSON.stringify({ lastShownAt: 1, closeStreak: -1, lastClosed: false }),
            JSON.stringify({ lastShownAt: 1, closeStreak: 0 }),
        ]) {
            localStorage.setItem("installCard", raw);
            expect(localUserStore.readInstallCard()).toBeUndefined();
        }
    });

    it("never throws when the browser blocks its storage", () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
            throw new Error("blocked");
        });
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw new Error("blocked");
        });
        vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
            throw new Error("blocked");
        });

        expect(localUserStore.readInstallCard()).toBeUndefined();
        expect(localUserStore.isInstallReported()).toBe(false);
        expect(() =>
            localUserStore.writeInstallCard({ lastShownAt: 1, closeStreak: 0, lastClosed: false })
        ).not.toThrow();
        expect(() => localUserStore.clearInstallCard()).not.toThrow();
        expect(() => localUserStore.markInstallReported()).not.toThrow();
        expect(() => localUserStore.clearInstallReported()).not.toThrow();
    });
});
