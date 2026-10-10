import { beforeEach, describe, expect, it, vi } from "vitest";

const save = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("../LocalUserStore", () => ({ localUserStore: { setLastRoomUrl: save } }));

import { forgetDeniedRoom, membersOnlyExit, rememberRoomLeft } from "../MembersOnlyExit";

const ORIGIN = "https://universe.example/@/uni/world/denied?x=1";

describe("membersOnlyExit", () => {
    beforeEach(() => {
        // Forget any room left by an earlier test: a move to another room that nothing asks about.
        rememberRoomLeft({ href: "https://universe.example/@/other" }, { key: "/@/other/room" });
    });

    it("goes back to the room the player came from", () => {
        rememberRoomLeft(
            { href: "https://universe.example/@/uni/world/cedar-hall#spawn", roomName: "Cedar Hall" },
            { key: "/@/uni/world/denied" }
        );
        expect(membersOnlyExit("/@/uni/world/denied", ORIGIN)).toEqual({
            kind: "back",
            href: "https://universe.example/@/uni/world/cedar-hall#spawn",
            name: "Cedar Hall",
        });
    });

    it("goes to the start room when the player opened a shared link", () => {
        expect(membersOnlyExit("/@/uni/world/denied", ORIGIN)).toEqual({
            kind: "start",
            href: "https://universe.example/",
        });
    });

    it("goes to the start room when the room left was for a different room than the one that turned them away", () => {
        rememberRoomLeft({ href: "https://universe.example/@/uni/world/cedar-hall" }, { key: "/@/uni/world/earlier" });
        expect(membersOnlyExit("/@/uni/world/denied", ORIGIN).kind).toBe("start");
    });

    it("goes to the start room when no room is known", () => {
        rememberRoomLeft({ href: "https://universe.example/@/uni/world/cedar-hall" }, { key: "/@/uni/world/denied" });
        expect(membersOnlyExit(undefined, ORIGIN).kind).toBe("start");
    });
});

describe("forgetDeniedRoom", () => {
    it("saves where the player goes, not the room that turned them away", async () => {
        save.mockClear();
        await forgetDeniedRoom({
            kind: "back",
            href: "https://universe.example/@/uni/world/cedar-hall",
            name: undefined,
        });
        expect(save).toHaveBeenCalledWith("https://universe.example/@/uni/world/cedar-hall");
        await forgetDeniedRoom({ kind: "start", href: "https://universe.example/" });
        expect(save).toHaveBeenLastCalledWith("https://universe.example/");
    });
});
