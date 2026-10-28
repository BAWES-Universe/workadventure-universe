import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../Connection/LocalUserStore", () => ({
    localUserStore: { setLastRoomUrl: vi.fn(() => Promise.resolve()) },
}));
vi.mock("../../Install/ManifestLink", () => ({ pointManifestAtRoom: vi.fn() }));

import type { Room } from "../../Connection/Room";
import { urlManager } from "../UrlManager";

function room(id: string, search = ""): Room {
    return { id, href: `http://localhost${id}`, search: new URLSearchParams(search) } as unknown as Room;
}

describe("UrlManager and the history (#1553)", () => {
    beforeEach(() => {
        history.replaceState(null, "", "/");
    });

    it("the room's address replaces the one the app opened on", () => {
        const before = history.length;
        urlManager.pushRoomIdToUrl(room("/@/bawes/hq/lobby"));
        expect(window.location.pathname).toBe("/@/bawes/hq/lobby");
        expect(history.length).toBe(before);
    });

    it("keeps what is in the history entry and the hash", () => {
        history.replaceState({ universeChat: true, chatStep: "a" }, "", "/#entrance");
        urlManager.pushRoomIdToUrl(room("/@/bawes/hq/lobby", "x=1"));
        expect(window.location.pathname + window.location.search + window.location.hash).toBe(
            "/@/bawes/hq/lobby?x=1#entrance"
        );
        expect(history.state).toEqual({ universeChat: true, chatStep: "a" });
    });

    it("start layers and cleared hashes don't add entries", () => {
        urlManager.pushRoomIdToUrl(room("/@/bawes/hq/lobby"));
        const before = history.length;
        urlManager.pushStartLayerNameToUrl("#garden");
        expect(window.location.hash).toBe("#garden");
        urlManager.clearHashParameter();
        expect(window.location.hash).toBe("");
        urlManager.pushStartLayerNameToUrl("");
        expect(history.length).toBe(before);
    });

    it("Back onto an entry from an earlier room keeps the current room's address", () => {
        urlManager.pushRoomIdToUrl(room("/@/bawes/hq/garden"));
        history.replaceState({ chat: "old" }, "", "/@/bawes/hq/lobby");
        window.dispatchEvent(new PopStateEvent("popstate", { state: { chat: "old" } }));
        expect(window.location.pathname).toBe("/@/bawes/hq/garden");
        expect(history.state).toEqual({ chat: "old" });
    });
});
