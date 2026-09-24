import { describe, expect, it } from "vitest";
import { captureSendDestination, isSendDestinationOpen, spaceGenerationOf } from "../SendDestination";

class FakeProximityRoom {
    id = "proximity";
    spaceGeneration = 1;
}

describe("send destination", () => {
    it("sends to the same space it was written in", () => {
        const room = new FakeProximityRoom();
        const destination = captureSendDestination(room);
        expect(isSendDestinationOpen(destination)).toBe(true);
    });

    it("drops a send when the bubble was left before the upload finished", () => {
        const room = new FakeProximityRoom();
        const destination = captureSendDestination(room);
        room.spaceGeneration++; // left bubble A
        room.spaceGeneration++; // entered bubble B
        expect(isSendDestinationOpen(destination)).toBe(false);
    });

    it("drops a send written with no bubble once a bubble is entered", () => {
        const room = new FakeProximityRoom();
        const destination = captureSendDestination(room);
        room.spaceGeneration++;
        expect(isSendDestinationOpen(destination)).toBe(false);
    });

    it("keeps the room it captured, whatever room is selected afterwards", () => {
        const roomA = { id: "!a" };
        const destination = captureSendDestination(roomA);
        expect(destination.room).toBe(roomA);
        expect(destination.spaceGeneration).toBeUndefined();
        expect(isSendDestinationOpen(destination)).toBe(true);
    });

    it("reads the generation of rooms that have one only", () => {
        expect(spaceGenerationOf(new FakeProximityRoom())).toBe(1);
        expect(spaceGenerationOf({ id: "!a" })).toBeUndefined();
        expect(spaceGenerationOf(undefined)).toBeUndefined();
    });
});
