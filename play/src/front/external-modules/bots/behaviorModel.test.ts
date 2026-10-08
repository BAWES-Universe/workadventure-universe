import { describe, expect, it } from "vitest";
import type { BotData } from "./types";
import {
    DEFAULT_NOTICE_RANGE,
    DEFAULT_WANDER_RADIUS,
    botModel,
    noticeRange,
    routeStops,
    withModel,
} from "./behaviorModel";

function bot(behaviorType: BotData["behaviorType"], config: Partial<BotData["behaviorConfig"]> = {}): BotData {
    return {
        id: "b1",
        behaviorType,
        behaviorConfig: { behaviorType, assignedSpace: { center: { x: 10, y: 20 }, radius: 0 }, ...config },
    };
}

describe("botModel", () => {
    it("reads the old types as answer pairs", () => {
        expect(botModel(bot("idle"))).toEqual({ moves: "stay", goesToPeople: false });
        expect(botModel(bot("patrol"))).toEqual({ moves: "route", goesToPeople: false });
        expect(botModel(bot("social"))).toEqual({ moves: "wander", goesToPeople: true });
        expect(botModel(undefined)).toEqual({ moves: "stay", goesToPeople: false });
    });

    it("lets saved answers win over the old type", () => {
        expect(botModel(bot("patrol", { moves: "stay", goesToPeople: true }))).toEqual({
            moves: "stay",
            goesToPeople: true,
        });
    });
});

describe("withModel", () => {
    it("writes the answers and the old type that fits them", () => {
        const next = withModel(bot("idle"), { moves: "route" });
        expect(next.behaviorType).toBe("patrol");
        expect(next.behaviorConfig).toMatchObject({ behaviorType: "patrol", moves: "route", goesToPeople: false });
    });

    it("keeps the route when the bot stops walking it", () => {
        const stops = [
            { x: 1, y: 2 },
            { x: 3, y: 4 },
        ];
        const wandering = withModel(bot("patrol", { patrolWaypoints: stops }), { moves: "wander" });
        expect(routeStops(wandering)).toEqual(stops);
        expect(routeStops(withModel(wandering, { moves: "route" }))).toEqual(stops);
    });

    it("gives a bot that starts wandering a circle, and keeps one it has", () => {
        expect(withModel(bot("idle"), { moves: "wander" }).behaviorConfig.assignedSpace.radius).toBe(
            DEFAULT_WANDER_RADIUS
        );
        const wide = bot("idle", { assignedSpace: { center: { x: 0, y: 0 }, radius: 300 } });
        expect(withModel(wide, { moves: "wander" }).behaviorConfig.assignedSpace.radius).toBe(300);
    });

    it("gives a bot that starts going to people the default notice range", () => {
        const next = withModel(bot("idle"), { goesToPeople: true });
        expect(next.behaviorConfig.conversationRadius).toBe(DEFAULT_NOTICE_RANGE);
        expect(noticeRange(withModel(bot("idle", { conversationRadius: 200 }), { goesToPeople: true }))).toBe(200);
    });
});

describe("routeStops", () => {
    it("reads either key and drops broken stops", () => {
        expect(routeStops(bot("patrol", { waypoints: [{ x: 1, y: 1 }, null, { x: "2" }] }))).toEqual([{ x: 1, y: 1 }]);
        expect(routeStops(bot("patrol"))).toEqual([]);
    });
});
