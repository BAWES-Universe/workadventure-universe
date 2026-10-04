import { readable } from "svelte/store";
import { describe, expect, it } from "vitest";
import { AvailabilityStatus } from "@workadventure/messages";
import type { OutgoingRing } from "../../Stores/RingStore";
import { lookOfCaller, ringButton, ringLine } from "./Ring";

const NOW = 1_000_000;

function entry(state: OutgoingRing["state"], extra: Partial<OutgoingRing> = {}): OutgoingRing {
    return { name: "Sara", state, startedAt: NOW - 12_000, until: NOW + 60_000, ...extra };
}

describe("ringButton", () => {
    it("is Ring for a free friend, Busy when they are busy, Stop while ringing", () => {
        expect(ringButton(undefined, AvailabilityStatus.ONLINE, NOW)).toEqual({ kind: "ring" });
        expect(ringButton(undefined, AvailabilityStatus.DO_NOT_DISTURB, NOW)).toEqual({ kind: "busy" });
        expect(ringButton(undefined, AvailabilityStatus.BACK_IN_A_MOMENT, NOW)).toEqual({ kind: "busy" });
        expect(ringButton(entry("ringing"), AvailabilityStatus.ONLINE, NOW)).toEqual({ kind: "stop" });
        expect(ringButton(entry("accepted"), AvailabilityStatus.ONLINE, NOW)).toEqual({ kind: "onTheWay" });
    });

    it("waits after a ring they didn't come for, then rings again", () => {
        const declined = entry("declined", { retryAt: NOW + 8 * 60_000 + 1 });
        expect(ringButton(declined, AvailabilityStatus.ONLINE, NOW)).toEqual({ kind: "wait", minutes: 9 });
        expect(ringButton(declined, AvailabilityStatus.ONLINE, NOW + 9 * 60_000)).toEqual({ kind: "ring" });
    });
});

describe("ringLine", () => {
    it("counts down while ringing and says how it went after", () => {
        expect(ringLine(entry("ringing"), NOW, 30_000)).toEqual({ kind: "ringing", seconds: 18 });
        expect(ringLine(entry("accepted"), NOW, 30_000)).toEqual({ kind: "onTheWay" });
        expect(ringLine(entry("declined"), NOW, 30_000)).toEqual({ kind: "notNow" });
        expect(ringLine(entry("no_answer"), NOW, 30_000)).toEqual({ kind: "noAnswer" });
        expect(ringLine(entry("stopped"), NOW, 30_000)).toBeUndefined();
        expect(ringLine(entry("too_soon"), NOW, 30_000)).toBeUndefined();
        expect(ringLine(undefined, NOW, 30_000)).toBeUndefined();
    });
});

describe("lookOfCaller", () => {
    it("finds the caller's woka in any room of this world, or none", () => {
        const picture = readable<string | undefined>("data:woka");
        const usersByRoom = new Map([
            ["https://play/@/u/w/hall", { users: [{ uuid: "noura" }] }],
            ["https://play/@/u/w/garden", { users: [{ uuid: "omar", pictureStore: picture, color: "#8629fc" }] }],
        ]);
        expect(lookOfCaller(usersByRoom, "omar")).toEqual({ picture, color: "#8629fc" });
        expect(lookOfCaller(usersByRoom, "lina")).toEqual({});
    });
});
