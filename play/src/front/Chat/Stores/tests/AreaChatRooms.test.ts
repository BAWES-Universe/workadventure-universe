import { get } from "svelte/store";
import { describe, expect, it } from "vitest";
import { AreaChatRoomTracker, collectAreaChatRoomIds, withoutAreaChatRooms } from "../AreaPresenceStore";

type FakeRoom = { id: string };

function room(id: string): FakeRoom {
    return { id };
}

/** What the main list shows, given the rooms Matrix currently reports. */
function mainList(tracker: AreaChatRoomTracker<FakeRoom>, matrixRooms: FakeRoom[]): string[] {
    return withoutAreaChatRooms(matrixRooms, get(tracker.hiddenRoomIds)).map((r) => r.id);
}

function rowRoomIds(tracker: AreaChatRoomTracker<FakeRoom>): string[] {
    return get(tracker.rows).map((entry) => entry.roomId);
}

describe("collectAreaChatRoomIds", () => {
    it("collects the Matrix room id of every area that has one", () => {
        const ids = collectAreaChatRoomIds([
            { properties: [{ type: "matrixRoomPropertyData", serverData: { matrixRoomId: "!a" } }] },
            { properties: [{ type: "livekitRoomProperty" }, { type: "matrixRoomPropertyData", serverData: {} }] },
            { properties: [{ type: "matrixRoomPropertyData", serverData: { matrixRoomId: "" } }] },
            { properties: [{ type: "matrixRoomPropertyData" }] },
            { properties: [{ type: "matrixRoomPropertyData", serverData: { matrixRoomId: "!b" } }] },
            { properties: [{ type: "openWebsite", serverData: { matrixRoomId: "!not-a-chat" } }] },
        ]);
        expect([...ids].sort()).toEqual(["!a", "!b"]);
    });
});

describe("withoutAreaChatRooms", () => {
    it("removes hidden rooms and keeps the order of the others", () => {
        const rooms = [room("1"), room("!area"), room("2")];
        expect(withoutAreaChatRooms(rooms, new Set(["!area"])).map((r) => r.id)).toEqual(["1", "2"]);
        expect(withoutAreaChatRooms(rooms, new Set()).map((r) => r.id)).toEqual(["1", "!area", "2"]);
    });
});

describe("AreaChatRoomTracker", () => {
    it("hides every area room of the map from the main list, even outside the area", () => {
        const tracker = new AreaChatRoomTracker<FakeRoom>();
        tracker.setMapRoomIds(["!a", "!b"]);
        expect(mainList(tracker, [room("dm"), room("!a"), room("!b"), room("design")])).toEqual(["dm", "design"]);
        expect(rowRoomIds(tracker)).toEqual([]);
    });

    it("room arrives before the area is entered: hidden by the map set, no row until the join completes", () => {
        const tracker = new AreaChatRoomTracker<FakeRoom>();
        tracker.setMapRoomIds(["!a"]);
        expect(mainList(tracker, [room("!a")])).toEqual([]);

        const entry = tracker.enter("area-a", "!a", "Lobby");
        expect(rowRoomIds(tracker)).toEqual([]);
        expect(tracker.markJoined(entry, room("!a"))).toBe(true);
        expect(rowRoomIds(tracker)).toEqual(["!a"]);
        expect(get(tracker.rows)[0].areaName).toBe("Lobby");
        expect(mainList(tracker, [room("!a")])).toEqual([]);
    });

    it("room arrives after the area is entered, even when the map does not know it yet", () => {
        const tracker = new AreaChatRoomTracker<FakeRoom>();
        const entry = tracker.enter("area-a", "!new");
        // The invitation / membership shows up in Matrix while the join is in flight.
        expect(mainList(tracker, [room("!new")])).toEqual([]);
        tracker.markJoined(entry, room("!new"));
        expect(mainList(tracker, [room("!new")])).toEqual([]);
        expect(rowRoomIds(tracker)).toEqual(["!new"]);
    });

    it("leave before the join settles: no row, no selection, and the room stays hidden until it settles", () => {
        const tracker = new AreaChatRoomTracker<FakeRoom>();
        const entry = tracker.enter("area-a", "!a");
        const joinSettled = tracker.beginSettle("!a");

        tracker.leave("area-a");
        expect(tracker.isCurrent(entry)).toBe(false);
        // Matrix reports the room while the late join lands.
        expect(mainList(tracker, [room("!a")])).toEqual([]);

        expect(tracker.markJoined(entry, room("!a"))).toBe(false);
        expect(rowRoomIds(tracker)).toEqual([]);

        const leaveSettled = tracker.beginSettle("!a");
        joinSettled();
        expect(mainList(tracker, [room("!a")])).toEqual([]);
        leaveSettled();
        // Not on the map any more and nothing in flight: it is an ordinary room again.
        expect(mainList(tracker, [room("!a")])).toEqual(["!a"]);
    });

    it("A → B → A: a join from the first visit of A cannot complete the second visit", () => {
        const tracker = new AreaChatRoomTracker<FakeRoom>();
        const firstA = tracker.enter("area-a", "!a");
        tracker.leave("area-a");
        const b = tracker.enter("area-b", "!b");
        tracker.markJoined(b, room("!b"));
        tracker.leave("area-b");
        const secondA = tracker.enter("area-a", "!a");

        expect(tracker.markJoined(firstA, room("!a"))).toBe(false);
        expect(rowRoomIds(tracker)).toEqual([]);
        expect(tracker.markJoined(secondA, room("!a"))).toBe(true);
        expect(rowRoomIds(tracker)).toEqual(["!a"]);
    });

    it("overlapping areas: newest first, and leaving B brings A back on top", () => {
        const tracker = new AreaChatRoomTracker<FakeRoom>();
        tracker.markJoined(tracker.enter("area-a", "!a"), room("!a"));
        tracker.markJoined(tracker.enter("area-b", "!b"), room("!b"));
        expect(rowRoomIds(tracker)).toEqual(["!b", "!a"]);

        tracker.leave("area-b");
        expect(rowRoomIds(tracker)).toEqual(["!a"]);
        expect(tracker.hasActiveRoom("!b")).toBe(false);
        expect(tracker.hasActiveRoom("!a")).toBe(true);
    });

    it("overlapping areas keep a stable order while their rooms join out of order", () => {
        const tracker = new AreaChatRoomTracker<FakeRoom>();
        const a = tracker.enter("area-a", "!a");
        const b = tracker.enter("area-b", "!b");
        tracker.markJoined(b, room("!b"));
        expect(rowRoomIds(tracker)).toEqual(["!b"]);
        tracker.markJoined(a, room("!a"));
        expect(rowRoomIds(tracker)).toEqual(["!b", "!a"]);
    });

    it("two areas sharing one room show one row, and leaving one keeps the room active", () => {
        const tracker = new AreaChatRoomTracker<FakeRoom>();
        tracker.markJoined(tracker.enter("area-a", "!shared"), room("!shared"));
        tracker.markJoined(tracker.enter("area-b", "!shared"), room("!shared"));
        expect(rowRoomIds(tracker)).toEqual(["!shared"]);
        tracker.leave("area-b");
        expect(tracker.hasActiveRoom("!shared")).toBe(true);
        expect(rowRoomIds(tracker)).toEqual(["!shared"]);
    });

    it("re-entering the same area replaces its entry instead of stacking it", () => {
        const tracker = new AreaChatRoomTracker<FakeRoom>();
        tracker.markJoined(tracker.enter("area-a", "!old"), room("!old"));
        const updated = tracker.enter("area-a", "!new");
        expect(tracker.activeCount).toBe(1);
        expect(rowRoomIds(tracker)).toEqual([]);
        tracker.markJoined(updated, room("!new"));
        expect(rowRoomIds(tracker)).toEqual(["!new"]);
    });

    it("leaving an area that was never entered changes nothing", () => {
        const tracker = new AreaChatRoomTracker<FakeRoom>();
        tracker.markJoined(tracker.enter("area-a", "!a"), room("!a"));
        expect(tracker.leave("unknown")).toBeUndefined();
        expect(rowRoomIds(tracker)).toEqual(["!a"]);
    });

    it("settle callbacks are counted and idempotent", () => {
        const tracker = new AreaChatRoomTracker<FakeRoom>();
        const first = tracker.beginSettle("!a");
        const second = tracker.beginSettle("!a");
        first();
        first();
        expect(mainList(tracker, [room("!a")])).toEqual([]);
        second();
        expect(mainList(tracker, [room("!a")])).toEqual(["!a"]);
    });

    it("each tab has its own tracker: two tabs in different areas show their own row", () => {
        const tabOne = new AreaChatRoomTracker<FakeRoom>();
        const tabTwo = new AreaChatRoomTracker<FakeRoom>();
        tabOne.markJoined(tabOne.enter("area-a", "!a"), room("!a"));
        tabTwo.markJoined(tabTwo.enter("area-b", "!b"), room("!b"));
        expect(rowRoomIds(tabOne)).toEqual(["!a"]);
        expect(rowRoomIds(tabTwo)).toEqual(["!b"]);
    });

    it("reset forgets everything for a new scene", () => {
        const tracker = new AreaChatRoomTracker<FakeRoom>();
        tracker.setMapRoomIds(["!a"]);
        tracker.markJoined(tracker.enter("area-a", "!a"), room("!a"));
        tracker.beginSettle("!x");
        tracker.reset();
        expect(rowRoomIds(tracker)).toEqual([]);
        expect(mainList(tracker, [room("!a"), room("!x")])).toEqual(["!a", "!x"]);
    });
});
